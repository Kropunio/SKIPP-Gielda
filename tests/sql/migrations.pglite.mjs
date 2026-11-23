// Test SQL na lokalnym Postgresie w WASM (pglite), bez dostępu do Supabase.
// Użycie: npm i --no-save @electric-sql/pglite && node tests/sql/migrations.pglite.mjs
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const R = new URL('../../', import.meta.url).href;
const { puzzleHashes } = await import(R + 'js/engine.js');
const scenario = JSON.parse(readFileSync(new URL('data/scenario.json', R), 'utf8'));

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create role anon nologin; create role authenticated nologin; create schema extensions; create publication supabase_realtime;`);
await db.exec(readFileSync(new URL('supabase/migrations/001_init.sql', R), 'utf8'));
await db.exec(readFileSync(new URL('supabase/migrations/002_hide_future_and_lockout.sql', R), 'utf8'));
await db.exec(readFileSync(new URL('supabase/migrations/002_hide_future_and_lockout.sql', R), 'utf8')); // idempotencja
console.log('migracje OK (2x 002)');

const q = async (sql, params) => (await db.query(sql, params)).rows;
const asAnon = async (fn) => { await db.exec('set role anon'); try { return await fn(); } finally { await db.exec('reset role'); } };
const rpc = (name, args) => asAnon(async () => {
  const keys = Object.keys(args);
  const rows = await q(`select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map((k) => args[k]));
  return rows;
});
const val = async (name, args) => { const r = await rpc(name, args); return r[0][name]; };

await assert.rejects(q(`select public.admin_init_game('t','1234',6)`), /8 znaków/);
await q(`select public.admin_init_game('t','pinpin12',6)`);

// ---- host_check z blokadą
assert.equal(await val('host_check', { p_game: 't', p_pin: 'zle' }), false);
assert.equal(await val('host_check', { p_game: 't', p_pin: 'pinpin12' }), true);
for (let i = 0; i < 8; i++) await val('host_check', { p_game: 't', p_pin: 'zle' + i });
await assert.rejects(val('host_check', { p_game: 't', p_pin: 'pinpin12' }), /odczekaj/);
await q(`update private.host_fails set locked_until = now() - interval '1 second'`);
assert.equal(await val('host_check', { p_game: 't', p_pin: 'pinpin12' }), true);
console.log('host_check: blokada OK');

// ---- upload scenariusza
const up = structuredClone(scenario);
up.puzzles = up.puzzles.map((p) => { const { answers, ...rest } = p; return { ...rest, answerHashes: puzzleHashes(p) }; });
await assert.rejects(rpc('get_scenario', { p_game: 't' }).then((r) => assert.equal(r[0].get_scenario, null)), /./).catch(() => {});
assert.equal(await val('get_scenario', { p_game: 't' }), null);
await rpc('host_upload_scenario', { p_game: 't', p_pin: 'pinpin12', p_scenario: JSON.stringify(up) });
await assert.rejects(rpc('host_upload_scenario', { p_game: 't', p_pin: 'zle', p_scenario: JSON.stringify(up) }), /PIN/);
const withAnswers = structuredClone(scenario);
await assert.rejects(rpc('host_upload_scenario', { p_game: 't', p_pin: 'pinpin12', p_scenario: JSON.stringify(withAnswers) }), /answerHashes|answers/);
console.log('upload OK');

const N = scenario.config.turns;
const priceArr = (sc, i) => sc.assets.filter((a) => a.prices).map((a) => a.prices);
const sc0 = await val('get_scenario', { p_game: 't' });
const stock = sc0.assets.find((a) => a.type === 'stock');
const stockFull = scenario.assets.find((a) => a.id === stock.id);
assert.equal(stock.prices.length, N + 1);
assert.equal(stock.prices[0], stockFull.prices[0]);
assert.ok(stock.prices.slice(1).every((p) => p === null), 'lobby: tylko kurs tury 1');
const bond = sc0.assets.find((a) => a.type === 'bond');
assert.equal(bond.rates.length, N);
assert.equal(bond.rates.filter((r) => r !== null).length, 1);
assert.ok(sc0.turns.every((t) => t.news.length === 0 && t.summary === ''), 'lobby: brak newsów');
assert.ok(sc0.puzzles.every((p) => !('answers' in p) && !('answerHashes' in p)));
assert.equal(JSON.stringify(sc0).includes(JSON.stringify(scenario.puzzles[0].answers?.[0] ?? 'zzzz-nie')), scenario.puzzles[0].answers ? false : false);
assert.equal(sc0._reveal.phase, 'lobby');
console.log('get_scenario lobby OK');

// ---- zespół, kody 6 cyfr, blokada
const team = (await rpc('host_create_team', { p_game: 't', p_pin: 'pinpin12', p_name: 'Alfa' }))[0];
assert.match(team.code, /^\d{6}$/);
const login = async (code) => (await rpc('team_login', { p_game: 't', p_name: ' alfa ', p_code: code }))[0];
assert.equal((await login(team.code)).status, 'ok');
const wrong = team.code === '000000' ? '111111' : '000000';
for (let i = 0; i < 9; i++) assert.equal((await login(wrong)).status, 'bad');
assert.equal((await login(wrong)).status, 'bad'); // 10. błąd → włącza blokadę
assert.equal((await login(team.code)).status, 'locked', 'poprawny kod też zablokowany w oknie blokady');
await q(`update private.team_fails set locked_until = now() - interval '1 second'`);
assert.equal((await login(team.code)).status, 'ok');
assert.equal((await q(`select fails from private.team_fails`))[0].fails, 0);
// handel: zły kod → -1, blokada → -2
const trade = (code) => val('team_trade', { p_game: 't', p_team: team.id, p_code: code, p_asset: 'x', p_side: 'buy', p_qty: 1 });
assert.equal(Number(await trade(wrong)), -1);
for (let i = 0; i < 9; i++) await trade(wrong);
assert.equal(Number(await trade(team.code)), -2);
const puz = (code) => val('team_puzzle', { p_game: 't', p_team: team.id, p_code: code, p_puzzle: scenario.puzzles[0].id, p_answer: 'x' });
assert.equal(await puz(team.code), 'locked');
await q(`update private.team_fails set locked_until = now() - interval '1 second'`);
assert.equal(await puz(wrong), 'denied');
assert.equal(await puz(team.code), 'wrong');
console.log('kody: blokada OK');

// ---- tura 1 otwarta
await rpc('host_start_turn', { p_game: 't', p_pin: 'pinpin12', p_duration: 600 });
const sc1 = await val('get_scenario', { p_game: 't' });
assert.ok(sc1.turns[0].news.length > 0 || scenario.turns[0].news.length === 0);
assert.ok(sc1.turns.slice(1).every((t) => t.news.length === 0), 'tury przyszłe puste');
assert.equal(sc1.turns[0].summary, '');
const s1 = sc1.assets.find((a) => a.id === stock.id);
assert.equal(s1.prices[0], stockFull.prices[0]);
assert.equal(s1.prices[1], null, 'kurs po turze 1 ukryty podczas tury 1');
assert.equal(sc1.assets.find((a) => a.type === 'bond').rates.filter((r) => r !== null).length, 1);
assert.deepEqual(sc1.turns[0].months.map((m) => m.event === null || m.event === undefined), scenario.turns[0].months.map((m, i) => i > 0 ? true : !m.event));
assert.equal(sc1._reveal.month, 1);
// przyszłe eventy: przesuń start tury w przeszłość o 70% → miesiąc 3
await q(`update public.games set turn_started_at = now() - interval '420 seconds' where id='t'`);
const sc1b = await val('get_scenario', { p_game: 't' });
assert.equal(sc1b._reveal.month, 3);
console.log('get_scenario tura 1 OK');

// ---- zamknięcie tury 1 → kurs 1 odsłonięty, rates[1] widoczne
await rpc('host_close_turn', { p_game: 't', p_pin: 'pinpin12' });
const sc2 = await val('get_scenario', { p_game: 't' });
const s2 = sc2.assets.find((a) => a.id === stock.id);
assert.equal(s2.prices[1], stockFull.prices[1]);
assert.equal(s2.prices[2], null);
assert.equal(sc2.assets.find((a) => a.type === 'bond').rates.filter((r) => r !== null).length, 2);
assert.equal(sc2.turns[0].summary, '', 'podsumowanie t1 dopiero na starcie t2');
await rpc('host_start_turn', { p_game: 't', p_pin: 'pinpin12', p_duration: 600 });
const sc3 = await val('get_scenario', { p_game: 't' });
assert.equal(sc3.turns[0].summary, scenario.turns[0].summary ?? '');
assert.ok(sc3.turns[1].news.length === scenario.turns[1].news.length);
console.log('get_scenario po turze OK');

// ---- anon nie czyta game_secrets
await assert.rejects(asAnon(() => q('select scenario from public.game_secrets')), /permission denied/);
await assert.rejects(asAnon(() => q('select * from private.team_fails')), /permission denied/);
console.log('WSZYSTKO OK');
