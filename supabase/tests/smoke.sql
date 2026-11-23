-- Test dymny migracji na lokalnym Postgresie (NIE na produkcji!). Opis w docs/SETUP.md.
-- Wymaga wcześniejszego wykonania 001_init.sql. Kończy się ROLLBACK — nic nie zostaje w bazie.
\set ON_ERROR_STOP 1
begin;
select public.admin_init_game('smoke', 'pin1234', 6);

set local role anon;

-- PIN
do $$ begin
  perform public.host_check('smoke', 'zly');
  raise exception 'FAIL: zły PIN przeszedł';
exception when sqlstate '28000' then raise notice 'OK: zły PIN odrzucony';
end $$;
select public.host_check('smoke', 'pin1234') as pin_ok;

-- anon nie może wywołać admin_init_game ani czytać sekretów / kodów ani pisać do tabel
do $$ begin
  perform public.admin_init_game('smoke', 'x', 6);
  raise exception 'FAIL: anon wywołał admin_init_game';
exception when insufficient_privilege then raise notice 'OK: admin_init_game niedostępne';
end $$;
do $$ begin
  perform * from public.game_secrets;
  raise exception 'FAIL: anon czyta game_secrets';
exception when insufficient_privilege then raise notice 'OK: game_secrets niedostępne';
end $$;
do $$ begin
  perform code_hash from public.teams;
  raise exception 'FAIL: anon czyta code_hash';
exception when insufficient_privilege then raise notice 'OK: code_hash niedostępny';
end $$;
do $$ begin
  insert into public.events (game_id, type, payload) values ('smoke', 'adjustment', '{}');
  raise exception 'FAIL: anon pisze do events';
exception when insufficient_privilege then raise notice 'OK: brak INSERT do events';
end $$;
do $$ begin
  update public.games set phase = 'open';
  raise exception 'FAIL: anon zmienia games';
exception when insufficient_privilege then raise notice 'OK: brak UPDATE games';
end $$;

-- zespół, logowanie, handel
create temp table t_team as select * from public.host_create_team('smoke', 'pin1234', 'Alfa');
select id, name, code ~ '^\d{4}$' as code_ok from t_team;
select count(*) = 1 as login_ok from t_team t, public.team_login('smoke', ' alfa ', t.code);
do $$ begin
  perform public.team_login('smoke', 'Alfa', '00000');
  raise exception 'FAIL';
exception when sqlstate '28000' then raise notice 'OK: zły kod odrzucony';
end $$;

do $$ declare t record; begin
  select * into t from t_team;
  begin
    perform public.team_trade('smoke', t.id, t.code, 'idx', 'buy', 1);
    raise exception 'FAIL: handel w lobby';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'OK: handel w lobby zablokowany (%)', sqlerrm;
  end;
end $$;

select public.host_start_turn('smoke', 'pin1234', 600) as started_turn;
select public.team_trade('smoke', t.id, t.code, 'idx', 'buy', 3) > 0 as trade_ok from t_team t;

-- zagadki
select public.host_sync_scenario('smoke', 'pin1234', 6,
  jsonb_build_object('z1', jsonb_build_array('ea4448baf0f9f24abd53ca804abc3ad969f61676dbabcafa08c1624d7ef5add1')));
select public.team_puzzle('smoke', t.id, t.code, 'z1', 'zle') = 'wrong' as puzzle_wrong from t_team t;
select public.team_puzzle('smoke', t.id, t.code, 'z1', 'haslojeden') = 'ok' as puzzle_ok from t_team t;
select public.team_puzzle('smoke', t.id, t.code, 'z1', 'haslojeden') = 'already' as puzzle_already from t_team t;

select public.host_adjust('smoke', 'pin1234', t.id, -500, 'test') > 0 as adjust_ok from t_team t;
select public.host_close_turn('smoke', 'pin1234') as phase_after_close;
select public.host_set_flags('smoke', 'pin1234', true, null);
select phase, turn, ranking_visible from public.games where id = 'smoke';
select type, turn, payload from public.events where game_id = 'smoke' order by id;
select public.host_reset_game('smoke', 'pin1234', true, true);
select phase, turn, test_mode, (select count(*) from public.events where game_id = 'smoke') as events from public.games where id = 'smoke';
reset role;
rollback;
