-- Giełda Hufca — schemat bazy (Supabase / Postgres 15+).
--
-- Zasady bezpieczeństwa:
--  * Klient (rola anon / authenticated) może tylko CZYTAĆ: games, events oraz kolumny id/game_id/name/created_at z teams.
--  * Kody zespołów, PIN prowadzącego i hashe haseł zagadek nie są czytelne dla klienta.
--  * Każdy zapis idzie przez funkcje RPC (security definer), które sprawdzają kod zespołu / PIN prowadzącego,
--    fazę gry i czas tury. Saldo i limity sprawdza deterministyczny silnik gry (js/engine.js) przy odtwarzaniu
--    zdarzeń — niepoprawna transakcja zostaje w dzienniku jako „odrzucona” i nie zmienia stanu.
--  * Funkcja admin_init_game jest dostępna tylko z SQL Editora (rola postgres) — ustawia PIN prowadzącego.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ------------------------------------------------------------------ tabele

create table public.games (
  id              text primary key check (id ~ '^[a-z0-9_-]{1,32}$'),
  phase           text not null default 'lobby' check (phase in ('lobby', 'open', 'closed', 'finished')),
  turn            int not null default 0 check (turn >= 0),
  total_turns     int not null default 6 check (total_turns between 1 and 20),
  turn_started_at timestamptz,
  turn_duration   int check (turn_duration between 5 and 7200),
  ranking_visible boolean not null default false,
  test_mode       boolean not null default false,
  rev             bigint not null default 0,
  updated_at      timestamptz not null default now()
);

create table public.game_secrets (
  game_id  text primary key references public.games (id) on delete cascade,
  pin_hash text not null,
  -- { "<id zagadki>": ["<sha256 znormalizowanego hasła>", ...] }
  puzzles  jsonb not null default '{}'::jsonb
);

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  game_id    text not null references public.games (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  code_hash  text not null,
  created_at timestamptz not null default now()
);
create unique index teams_game_name_uniq on public.teams (game_id, lower(btrim(name)));

create table public.events (
  id         bigint generated always as identity primary key,
  game_id    text not null references public.games (id) on delete cascade,
  type       text not null check (type in ('trade', 'puzzle', 'adjustment', 'turn')),
  team_id    uuid references public.teams (id) on delete cascade,
  turn       int,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_game_id_idx on public.events (game_id, id);
create index events_team_created_idx on public.events (team_id, created_at);

-- Zdarzenia są append-only: brak UPDATE/DELETE dla klientów (RLS + brak grantów).

-- ------------------------------------------------------------------ RLS i uprawnienia

alter table public.games        enable row level security;
alter table public.game_secrets enable row level security;
alter table public.teams        enable row level security;
alter table public.events       enable row level security;

revoke all on public.games, public.game_secrets, public.teams, public.events from public, anon, authenticated;

grant select on public.games  to anon, authenticated;
grant select on public.events to anon, authenticated;
grant select (id, game_id, name, created_at) on public.teams to anon, authenticated;
-- game_secrets: brak grantów i brak polityk → całkowicie niedostępne dla klienta.

create policy games_read  on public.games  for select to anon, authenticated using (true);
create policy events_read on public.events for select to anon, authenticated using (true);
create policy teams_read  on public.teams  for select to anon, authenticated using (true);

-- Realtime (postgres_changes) dla stanu gry i zdarzeń.
alter publication supabase_realtime add table public.games, public.events;

-- ------------------------------------------------------------------ funkcje pomocnicze (prywatne)

create or replace function private.assert_host(p_game text, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash from public.game_secrets where game_id = p_game;
  if v_hash is null or p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    raise exception 'Nieprawidłowy PIN prowadzącego.' using errcode = '28000';
  end if;
end;
$$;

create or replace function private.assert_team(p_game text, p_team uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  select code_hash into v_hash from public.teams where id = p_team and game_id = p_game;
  if v_hash is null or p_code is null or extensions.crypt(p_code, v_hash) <> v_hash then
    raise exception 'Nieprawidłowy zespół lub kod.' using errcode = '28000';
  end if;
end;
$$;

create or replace function private.rate_limit(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.events where team_id = p_team and created_at > now() - interval '5 seconds') >= 20 then
    raise exception 'Za dużo operacji naraz — odczekaj chwilę.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.bump(p_game text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.games set rev = rev + 1, updated_at = now() where id = p_game;
$$;

create or replace function private.random_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select lpad(((('x' || encode(extensions.gen_random_bytes(3), 'hex'))::bit(24)::int) % 10000)::text, 4, '0');
$$;

-- ------------------------------------------------------------------ administracja (tylko SQL Editor)

-- Użycie w SQL Editorze: select public.admin_init_game('gielda', 'TwójPIN');
create or replace function public.admin_init_game(p_game text, p_pin text, p_total_turns int default 6)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin is null or char_length(p_pin) < 4 then
    raise exception 'PIN musi mieć co najmniej 4 znaki.';
  end if;
  insert into public.games (id, total_turns) values (p_game, p_total_turns)
    on conflict (id) do update set total_turns = excluded.total_turns;
  insert into public.game_secrets (game_id, pin_hash)
    values (p_game, extensions.crypt(p_pin, extensions.gen_salt('bf')))
    on conflict (game_id) do update set pin_hash = excluded.pin_hash;
  perform private.bump(p_game);
end;
$$;

-- ------------------------------------------------------------------ RPC: wspólne

create or replace function public.server_time()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now(); $$;

-- ------------------------------------------------------------------ RPC: prowadzący

create or replace function public.host_check(p_game text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_host(p_game, p_pin);
  return true;
end;
$$;

-- Synchronizacja danych ze scenariusza potrzebnych serwerowi (liczba tur, hashe haseł zagadek).
create or replace function public.host_sync_scenario(p_game text, p_pin text, p_total_turns int, p_puzzles jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_host(p_game, p_pin);
  if p_total_turns is null or p_total_turns not between 1 and 20 then
    raise exception 'Nieprawidłowa liczba tur.';
  end if;
  if jsonb_typeof(coalesce(p_puzzles, '{}'::jsonb)) <> 'object' then
    raise exception 'Nieprawidłowy format zagadek.';
  end if;
  update public.games set total_turns = p_total_turns where id = p_game and total_turns <> p_total_turns;
  update public.game_secrets set puzzles = coalesce(p_puzzles, '{}'::jsonb) where game_id = p_game;
  perform private.bump(p_game);
end;
$$;

create or replace function public.host_reset_game(p_game text, p_pin text, p_keep_teams boolean, p_test_mode boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_host(p_game, p_pin);
  perform 1 from public.games where id = p_game for update;
  delete from public.events where game_id = p_game;
  if not coalesce(p_keep_teams, true) then
    delete from public.teams where game_id = p_game;
  end if;
  update public.games
     set phase = 'lobby', turn = 0, turn_started_at = null, turn_duration = null,
         ranking_visible = false, test_mode = coalesce(p_test_mode, false)
   where id = p_game;
  perform private.bump(p_game);
end;
$$;

create or replace function public.host_create_team(p_game text, p_pin text, p_name text)
returns table (id uuid, name text, code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := private.random_code();
  v_id uuid;
  v_name text := btrim(p_name);
begin
  perform private.assert_host(p_game, p_pin);
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'Nazwa zespołu: 1–40 znaków.';
  end if;
  if exists (select 1 from public.teams t where t.game_id = p_game and lower(btrim(t.name)) = lower(v_name)) then
    raise exception 'Zespół o tej nazwie już istnieje.';
  end if;
  insert into public.teams (game_id, name, code_hash)
    values (p_game, v_name, extensions.crypt(v_code, extensions.gen_salt('bf')))
    returning teams.id into v_id;
  perform private.bump(p_game);
  return query select v_id, v_name, v_code;
end;
$$;

create or replace function public.host_regen_code(p_game text, p_pin text, p_team uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := private.random_code();
begin
  perform private.assert_host(p_game, p_pin);
  update public.teams set code_hash = extensions.crypt(v_code, extensions.gen_salt('bf'))
   where id = p_team and game_id = p_game;
  if not found then raise exception 'Nie ma takiego zespołu.'; end if;
  return v_code;
end;
$$;

create or replace function public.host_delete_team(p_game text, p_pin text, p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_host(p_game, p_pin);
  delete from public.teams where id = p_team and game_id = p_game;
  perform private.bump(p_game);
end;
$$;

create or replace function public.host_start_turn(p_game text, p_pin text, p_duration int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  v_turn int;
begin
  perform private.assert_host(p_game, p_pin);
  select * into g from public.games where id = p_game for update;
  if g.phase = 'lobby' then v_turn := 1;
  elsif g.phase = 'closed' then v_turn := g.turn + 1;
  else raise exception 'Nie można teraz rozpocząć tury (faza: %).', g.phase;
  end if;
  if v_turn > g.total_turns then raise exception 'Wszystkie tury zostały rozegrane.'; end if;
  if p_duration is null or p_duration not between 5 and 7200 then raise exception 'Nieprawidłowa długość tury.'; end if;
  insert into public.events (game_id, type, turn, payload)
    values (p_game, 'turn', v_turn, jsonb_build_object('action', 'start', 'turn', v_turn, 'duration', p_duration));
  update public.games
     set phase = 'open', turn = v_turn, turn_started_at = now(), turn_duration = p_duration
   where id = p_game;
  perform private.bump(p_game);
  return v_turn;
end;
$$;

create or replace function public.host_close_turn(p_game text, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  v_phase text;
begin
  perform private.assert_host(p_game, p_pin);
  select * into g from public.games where id = p_game for update;
  if g.phase <> 'open' then raise exception 'Nie ma otwartej tury.'; end if;
  insert into public.events (game_id, type, turn, payload)
    values (p_game, 'turn', g.turn, jsonb_build_object('action', 'close', 'turn', g.turn));
  v_phase := case when g.turn >= g.total_turns then 'finished' else 'closed' end;
  update public.games set phase = v_phase, turn_started_at = null where id = p_game;
  perform private.bump(p_game);
  return v_phase;
end;
$$;

create or replace function public.host_set_flags(p_game text, p_pin text, p_ranking_visible boolean default null, p_test_mode boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_host(p_game, p_pin);
  update public.games
     set ranking_visible = coalesce(p_ranking_visible, ranking_visible),
         test_mode = coalesce(p_test_mode, test_mode)
   where id = p_game;
  perform private.bump(p_game);
end;
$$;

create or replace function public.host_adjust(p_game text, p_pin text, p_team uuid, p_amount bigint, p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform private.assert_host(p_game, p_pin);
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000000 then
    raise exception 'Nieprawidłowa kwota korekty.';
  end if;
  if not exists (select 1 from public.teams where id = p_team and game_id = p_game) then
    raise exception 'Nie ma takiego zespołu.';
  end if;
  insert into public.events (game_id, type, team_id, turn, payload)
    select p_game, 'adjustment', p_team, g.turn,
           jsonb_build_object('amount', p_amount, 'note', left(coalesce(p_note, ''), 200))
      from public.games g where g.id = p_game
    returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------------ RPC: zespoły

create or replace function public.team_login(p_game text, p_name text, p_code text)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
begin
  if p_code is null or p_code !~ '^\d{4}$' then
    raise exception 'Kod to 4 cyfry.' using errcode = '28000';
  end if;
  select * into t from public.teams
   where game_id = p_game and lower(btrim(teams.name)) = lower(btrim(p_name));
  if t.id is null or extensions.crypt(p_code, t.code_hash) <> t.code_hash then
    raise exception 'Zła nazwa zespołu lub kod.' using errcode = '28000';
  end if;
  return query select t.id, t.name;
end;
$$;

create or replace function public.team_trade(p_game text, p_team uuid, p_code text, p_asset text, p_side text, p_qty bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  v_id bigint;
begin
  perform private.assert_team(p_game, p_team, p_code);
  perform private.rate_limit(p_team);
  select * into g from public.games where id = p_game;
  if g.phase <> 'open' then raise exception 'Handel jest teraz zamknięty.'; end if;
  if now() > g.turn_started_at + make_interval(secs => g.turn_duration + 3) then
    raise exception 'Czas tury minął.';
  end if;
  if p_asset is null or p_asset !~ '^[a-z0-9_-]{1,32}$' then raise exception 'Nieznane aktywo.'; end if;
  if p_side not in ('buy', 'sell') then raise exception 'Nieznany rodzaj transakcji.'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000000000 then raise exception 'Nieprawidłowa ilość.'; end if;
  insert into public.events (game_id, type, team_id, turn, payload)
    values (p_game, 'trade', p_team, g.turn, jsonb_build_object('asset', p_asset, 'side', p_side, 'qty', p_qty))
    returning id into v_id;
  return v_id;
end;
$$;

-- p_answer: hasło już znormalizowane przez klienta (js/engine.js normalizeAnswer); serwer porównuje SHA-256.
-- Zwraca 'ok' | 'wrong' | 'already'.
create or replace function public.team_puzzle(p_game text, p_team uuid, p_code text, p_puzzle text, p_answer text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  v_hashes jsonb;
  v_hash text;
begin
  perform private.assert_team(p_game, p_team, p_code);
  perform private.rate_limit(p_team);
  select * into g from public.games where id = p_game;
  if g.phase = 'finished' then raise exception 'Gra zakończona.'; end if;
  select s.puzzles -> p_puzzle into v_hashes from public.game_secrets s where s.game_id = p_game;
  if v_hashes is null then raise exception 'Nieznana zagadka (prowadzący musi zsynchronizować scenariusz).'; end if;
  if exists (select 1 from public.events e where e.game_id = p_game and e.team_id = p_team and e.type = 'puzzle'
               and e.payload ->> 'puzzle' = p_puzzle) then
    return 'already';
  end if;
  v_hash := encode(extensions.digest(coalesce(p_answer, ''), 'sha256'), 'hex');
  if coalesce(p_answer, '') = '' or not (v_hashes ? v_hash) then
    return 'wrong';
  end if;
  insert into public.events (game_id, type, team_id, turn, payload)
    values (p_game, 'puzzle', p_team, g.turn, jsonb_build_object('puzzle', p_puzzle));
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ uprawnienia do funkcji

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.server_time(),
  public.host_check(text, text),
  public.host_sync_scenario(text, text, int, jsonb),
  public.host_reset_game(text, text, boolean, boolean),
  public.host_create_team(text, text, text),
  public.host_regen_code(text, text, uuid),
  public.host_delete_team(text, text, uuid),
  public.host_start_turn(text, text, int),
  public.host_close_turn(text, text),
  public.host_set_flags(text, text, boolean, boolean),
  public.host_adjust(text, text, uuid, bigint, text),
  public.team_login(text, text, text),
  public.team_trade(text, uuid, text, text, text, bigint),
  public.team_puzzle(text, uuid, text, text, text)
to anon, authenticated;
-- public.admin_init_game: celowo bez grantu dla anon/authenticated (tylko SQL Editor / service_role).
