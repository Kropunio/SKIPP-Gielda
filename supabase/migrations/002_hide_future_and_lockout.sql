-- Giełda Hufca — migracja 002: ukrycie przyszłych kursów i newsów + blokada zgadywania kodów.
-- Wymaga wcześniejszego wykonania 001_init.sql. Można uruchomić ponownie (idempotentna).
--
-- 1) Scenariusz (kursy, stopy, newsy, eventy) leży w game_secrets.scenario — niedostępny dla klienta.
--    Klient dostaje go przez get_scenario(): kursy/stopy/newsy tylko tur już odsłoniętych, reszta = null / puste.
--    Prowadzący wgrywa scenariusz funkcją host_upload_scenario (panel: „Wgraj scenariusz”).
-- 2) Kody zespołów: 6 cyfr + blokada po 10 błędnych próbach na 15 s (logowanie, handel, zagadki).
--    Błąd kodu NIE rzuca wyjątku (wyjątek cofnąłby licznik) — zwracany jest status.
-- 3) host_check: blokada po 8 błędnych PIN-ach na 30 s. Uwaga: pozostałe funkcje host_* nadal rzucają wyjątek
--    przy złym PIN-ie (bez licznika) — używaj PIN-u min. 8 znaków (admin_init_game to teraz wymusza).

-- ------------------------------------------------------------------ kolumny i tabele pomocnicze

alter table public.game_secrets add column if not exists scenario jsonb;

create table if not exists private.team_fails (
  team_id      uuid primary key references public.teams (id) on delete cascade,
  fails        int not null default 0,
  locked_until timestamptz
);
create table if not exists private.host_fails (
  game_id      text primary key references public.games (id) on delete cascade,
  fails        int not null default 0,
  locked_until timestamptz
);
revoke all on private.team_fails, private.host_fails from public, anon, authenticated;

-- ------------------------------------------------------------------ kody 6-cyfrowe

create or replace function private.random_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select lpad((abs((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000))::text, 6, '0');
$$;

-- Weryfikacja kodu zespołu z licznikiem błędów. Zwraca 'ok' | 'bad' | 'locked'.
-- Nie rzuca wyjątku przy błędnym kodzie, żeby licznik został zapisany.
create or replace function private.team_guard(p_game text, p_team uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  f private.team_fails;
  v_fails int;
begin
  select code_hash into v_hash from public.teams where id = p_team and game_id = p_game;
  if v_hash is null then return 'bad'; end if;
  insert into private.team_fails (team_id) values (p_team) on conflict do nothing;
  select * into f from private.team_fails where team_id = p_team for update;  -- serializuje próby jednego zespołu
  if f.locked_until is not null and f.locked_until > now() then return 'locked'; end if;
  v_fails := case when f.locked_until is not null then 0 else f.fails end;   -- po wygaśnięciu blokady liczymy od zera
  if p_code is not null and extensions.crypt(p_code, v_hash) = v_hash then
    if f.fails <> 0 or f.locked_until is not null then
      update private.team_fails set fails = 0, locked_until = null where team_id = p_team;
    end if;
    return 'ok';
  end if;
  v_fails := v_fails + 1;
  update private.team_fails
     set fails = v_fails,
         locked_until = case when v_fails >= 10 then now() + interval '15 seconds' else null end
   where team_id = p_team;
  return 'bad';
end;
$$;

-- private.assert_team zostaje (używają go ewentualne starsze wywołania), ale nowe RPC korzystają z team_guard.

-- ------------------------------------------------------------------ admin_init_game: PIN min. 8 znaków

create or replace function public.admin_init_game(p_game text, p_pin text, p_total_turns int default 6)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin is null or char_length(p_pin) < 8 then
    raise exception 'PIN musi mieć co najmniej 8 znaków (zgadywanie PIN-u nie jest blokowane we wszystkich funkcjach).';
  end if;
  insert into public.games (id, total_turns) values (p_game, p_total_turns)
    on conflict (id) do update set total_turns = excluded.total_turns;
  insert into public.game_secrets (game_id, pin_hash)
    values (p_game, extensions.crypt(p_pin, extensions.gen_salt('bf')))
    on conflict (game_id) do update set pin_hash = excluded.pin_hash;
  delete from private.host_fails where game_id = p_game;
  perform private.bump(p_game);
end;
$$;

-- ------------------------------------------------------------------ host_check z blokadą

create or replace function public.host_check(p_game text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  f private.host_fails;
  v_fails int;
begin
  select pin_hash into v_hash from public.game_secrets where game_id = p_game;
  if v_hash is null then
    raise exception 'Nieprawidłowy PIN prowadzącego.' using errcode = '28000';
  end if;
  insert into private.host_fails (game_id) values (p_game) on conflict do nothing;
  select * into f from private.host_fails where game_id = p_game for update;
  if f.locked_until is not null and f.locked_until > now() then
    raise exception 'Zbyt wiele błędnych prób — odczekaj chwilę.' using errcode = '28000';
  end if;
  v_fails := case when f.locked_until is not null then 0 else f.fails end;
  if p_pin is not null and extensions.crypt(p_pin, v_hash) = v_hash then
    if f.fails <> 0 or f.locked_until is not null then
      update private.host_fails set fails = 0, locked_until = null where game_id = p_game;
    end if;
    return true;
  end if;
  v_fails := v_fails + 1;
  update private.host_fails
     set fails = v_fails,
         locked_until = case when v_fails >= 8 then now() + interval '30 seconds' else null end
   where game_id = p_game;
  return false;   -- bez wyjątku, żeby licznik został zapisany (klient pokazuje „Nieprawidłowy PIN”)
end;
$$;

-- ------------------------------------------------------------------ logowanie / handel / zagadki

drop function if exists public.team_login(text, text, text);
create function public.team_login(p_game text, p_name text, p_code text)
returns table (id uuid, name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  v_status text;
begin
  select * into t from public.teams
   where game_id = p_game and lower(btrim(teams.name)) = lower(btrim(p_name));
  if t.id is null or p_code is null or p_code !~ '^\d{4,8}$' then
    return query select null::uuid, null::text, 'bad'::text;
    return;
  end if;
  v_status := private.team_guard(p_game, t.id, p_code);
  if v_status = 'ok' then
    return query select t.id, t.name, 'ok'::text;
  else
    return query select null::uuid, null::text, v_status;
  end if;
end;
$$;

-- Zwraca id zdarzenia (> 0) albo -1 (zły kod) / -2 (blokada po błędnych próbach).
create or replace function public.team_trade(p_game text, p_team uuid, p_code text, p_asset text, p_side text, p_qty bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  v_id bigint;
  v_status text;
begin
  v_status := private.team_guard(p_game, p_team, p_code);
  if v_status = 'bad' then return -1; end if;
  if v_status = 'locked' then return -2; end if;
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

-- Zwraca 'ok' | 'wrong' | 'already' | 'denied' (zły kod) | 'locked' (blokada).
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
  v_status text;
begin
  v_status := private.team_guard(p_game, p_team, p_code);
  if v_status = 'bad' then return 'denied'; end if;
  if v_status = 'locked' then return 'locked'; end if;
  perform private.rate_limit(p_team);
  select * into g from public.games where id = p_game;
  if g.phase = 'finished' then raise exception 'Gra zakończona.'; end if;
  select s.puzzles -> p_puzzle into v_hashes from public.game_secrets s where s.game_id = p_game;
  if v_hashes is null then raise exception 'Nieznana zagadka (prowadzący musi wgrać scenariusz).'; end if;
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

-- ------------------------------------------------------------------ scenariusz w bazie

-- Wgranie pełnego scenariusza (bez haseł jawnych: zagadki mają answerHashes).
create or replace function public.host_upload_scenario(p_game text, p_pin text, p_scenario jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turns int;
  v_puzzles jsonb;
  v_clean jsonb;
begin
  perform private.assert_host(p_game, p_pin);
  if p_scenario is null or jsonb_typeof(p_scenario) <> 'object' then raise exception 'Scenariusz musi być obiektem JSON.'; end if;
  if octet_length(p_scenario::text) > 3000000 then raise exception 'Scenariusz jest za duży (max 3 MB).'; end if;
  begin
    v_turns := (p_scenario -> 'config' ->> 'turns')::int;
  exception when others then
    raise exception 'Brak config.turns w scenariuszu.';
  end;
  if v_turns is null or v_turns not between 1 and 20 then raise exception 'Nieprawidłowa liczba tur.'; end if;
  if jsonb_typeof(p_scenario -> 'assets') <> 'array' or jsonb_typeof(p_scenario -> 'turns') <> 'array'
     or jsonb_array_length(p_scenario -> 'turns') <> v_turns then
    raise exception 'Scenariusz: wymagane assets oraz turns o długości config.turns.';
  end if;
  if jsonb_typeof(coalesce(p_scenario -> 'puzzles', '[]'::jsonb)) <> 'array' then raise exception 'Scenariusz: puzzles musi być listą.'; end if;

  -- hashe haseł zagadek: { id: [hash, ...] }
  select coalesce(jsonb_object_agg(z ->> 'id', coalesce(z -> 'answerHashes', '[]'::jsonb)), '{}'::jsonb)
    into v_puzzles
    from jsonb_array_elements(coalesce(p_scenario -> 'puzzles', '[]'::jsonb)) z;
  if exists (select 1 from jsonb_array_elements(coalesce(p_scenario -> 'puzzles', '[]'::jsonb)) z
              where z ? 'answers' or jsonb_typeof(coalesce(z -> 'answerHashes', '[]'::jsonb)) <> 'array'
                 or jsonb_array_length(coalesce(z -> 'answerHashes', '[]'::jsonb)) = 0) then
    raise exception 'Zagadki muszą mieć answerHashes i nie mogą zawierać jawnych haseł (answers).';
  end if;

  update public.game_secrets set scenario = p_scenario, puzzles = v_puzzles where game_id = p_game;
  update public.games set total_turns = v_turns where id = p_game;
  perform private.bump(p_game);
end;
$$;

-- Scenariusz dla klienta: tylko to, co już odsłonięte w bieżącej fazie gry.
--   kursy    : indeksy 0..idx (idx jak w engine.priceIndexFor); reszta = null
--   stopy    : pierwsze r wartości (r jak w UI: bieżąca tura albo następna po zamknięciu); reszta = null
--   newsy    : tury 1..turn (od startu tury); tury przyszłe puste
--   podsum.  : tur < bieżąca albo wszystkie po zakończeniu gry
--   eventy   : miesięcy tury bieżącej do aktualnego miesiąca (wg zegara serwera); tury minione w całości
create or replace function public.get_scenario(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.games;
  sc jsonb;
  n int;
  v_idx int;
  v_rates int;
  v_vis int;
  v_mpt int;
  v_month int := 0;
  v_elapsed numeric;
  v_assets jsonb;
  v_turns jsonb;
  v_puzzles jsonb;
begin
  select * into g from public.games where id = p_game;
  if not found then return null; end if;
  select s.scenario into sc from public.game_secrets s where s.game_id = p_game;
  if sc is null then return null; end if;

  n := (sc -> 'config' ->> 'turns')::int;
  v_mpt := coalesce((sc -> 'config' ->> 'monthsPerTurn')::int, 3);
  v_idx := case g.phase when 'lobby' then 0 when 'open' then g.turn - 1 when 'finished' then n else least(g.turn, n) end;
  v_rates := case g.phase when 'lobby' then 1 when 'open' then g.turn when 'finished' then n else least(g.turn + 1, n) end;
  v_vis := case g.phase when 'lobby' then 0 else g.turn end;
  if g.phase = 'open' and g.turn_started_at is not null and g.turn_duration > 0 then
    v_elapsed := extract(epoch from (now() - g.turn_started_at));
    v_month := least(v_mpt, greatest(1, floor(v_elapsed / (g.turn_duration::numeric / v_mpt))::int + 1));
  end if;

  select coalesce(jsonb_agg(
    case
      when a ? 'prices' then jsonb_set(a, '{prices}', coalesce((
        select jsonb_agg(case when ord - 1 <= v_idx then p else 'null'::jsonb end order by ord)
          from jsonb_array_elements(a -> 'prices') with ordinality as t(p, ord)), '[]'::jsonb))
      when a ? 'rates' then jsonb_set(a, '{rates}', coalesce((
        select jsonb_agg(case when ord <= v_rates then p else 'null'::jsonb end order by ord)
          from jsonb_array_elements(a -> 'rates') with ordinality as t(p, ord)), '[]'::jsonb))
      else a
    end order by o), '[]'::jsonb)
    into v_assets
    from jsonb_array_elements(sc -> 'assets') with ordinality as x(a, o);

  select coalesce(jsonb_agg(
    (tt - 'news' - 'summary' - 'months') || jsonb_build_object(
      'news', case when o <= v_vis then coalesce(tt -> 'news', '[]'::jsonb) else '[]'::jsonb end,
      'summary', case when o < g.turn or g.phase = 'finished' then coalesce(tt -> 'summary', to_jsonb(''::text)) else to_jsonb(''::text) end,
      'months', coalesce((
        select jsonb_agg(
          (m - 'event') || jsonb_build_object('event',
            case when o < g.turn or (o = g.turn and g.phase <> 'open') or (o = g.turn and mo <= v_month)
                 then coalesce(m -> 'event', 'null'::jsonb) else 'null'::jsonb end)
          order by mo)
          from jsonb_array_elements(tt -> 'months') with ordinality as mm(m, mo)), '[]'::jsonb)
    ) order by o), '[]'::jsonb)
    into v_turns
    from jsonb_array_elements(sc -> 'turns') with ordinality as y(tt, o);

  select coalesce(jsonb_agg(z - 'answers' - 'answerHashes' order by o), '[]'::jsonb)
    into v_puzzles
    from jsonb_array_elements(coalesce(sc -> 'puzzles', '[]'::jsonb)) with ordinality as w(z, o);

  return (sc - 'assets' - 'turns' - 'puzzles') || jsonb_build_object(
    'assets', v_assets,
    'turns', v_turns,
    'puzzles', v_puzzles,
    '_reveal', jsonb_build_object('phase', g.phase, 'turn', g.turn, 'month', v_month, 'rev', g.rev)
  );
end;
$$;

-- ------------------------------------------------------------------ uprawnienia

revoke all on function
  public.get_scenario(text),
  public.host_upload_scenario(text, text, jsonb),
  public.team_login(text, text, text),
  private.team_guard(text, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.get_scenario(text),
  public.host_upload_scenario(text, text, jsonb),
  public.team_login(text, text, text)
to anon, authenticated;
-- host_check, team_trade, team_puzzle: uprawnienia z 001 zostają (create or replace ich nie zmienia).
-- admin_init_game: nadal bez grantu dla anon/authenticated.
