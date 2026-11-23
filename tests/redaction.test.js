// Scenariusz „odsłonięty” (tryb Supabase): silnik musi liczyć tak samo na danych z null-ami w przyszłych kursach,
// a wgrywany scenariusz nie może zawierać jawnych haseł zagadek.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalStore, scenarioForUpload } from '../js/store.js';
import { replay, ranking, priceIndexFor, PHASE } from '../js/engine.js';
import { validateScenario } from '../js/scenario.js';

const scenario = JSON.parse(readFileSync(new URL('../data/scenario.json', import.meta.url), 'utf8'));

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

/** To samo, co robi SQL get_scenario dla kursów i stóp (testowane osobno na Postgresie). */
function reveal(sc, phase, turn) {
  const N = sc.config.turns;
  const idx = priceIndexFor(phase, turn, N);
  const rates = phase === 'lobby' ? 1 : phase === 'open' ? turn : phase === 'finished' ? N : Math.min(turn + 1, N);
  const out = JSON.parse(JSON.stringify(sc));
  for (const a of out.assets) {
    if (a.prices) a.prices = a.prices.map((p, i) => (i <= idx ? p : null));
    if (a.rates) a.rates = a.rates.map((r, i) => (i < rates ? r : null));
  }
  out.turns.forEach((t, i) => { if (i + 1 > (phase === 'lobby' ? 0 : turn)) t.news = []; });
  return out;
}

test('scenarioForUpload: brak jawnych haseł, są hashe', () => {
  const up = scenarioForUpload(scenario);
  assert.equal(up.puzzles.length, scenario.puzzles.length);
  for (const p of up.puzzles) {
    assert.ok(!('answers' in p));
    assert.ok(p.answerHashes.length > 0 && p.answerHashes.every((h) => /^[0-9a-f]{64}$/.test(h)));
  }
  assert.ok(!JSON.stringify(up).includes(String(scenario.puzzles[0].answers?.[0] ?? '\u0000nie-ma')));
  assert.equal(validateScenario(up).ok, true, validateScenario(up).errors.join('; '));
});

test('validateScenario partial: null-e w przyszłych kursach OK tylko w trybie częściowym', () => {
  const r = reveal(scenarioForUpload(scenario), 'open', 2);
  r.puzzles = r.puzzles.map(({ answerHashes, ...rest }) => rest);
  assert.equal(validateScenario(r).ok, false);
  const v = validateScenario(r, { partial: true });
  assert.equal(v.ok, true, v.errors.join('; '));
});

test('silnik liczy tak samo na scenariuszu odsłoniętym do bieżącej fazy', async () => {
  const store = new LocalStore('red', new MemStorage());
  await store.init();
  await store.hostSetup('1234', scenario.config.turns);
  await store.hostSyncScenario('1234', scenario);
  const a = await store.hostCreateTeam('1234', 'Alfa');
  const buyable = scenario.assets.filter((x) => x.type === 'stock' || x.type === 'index');
  for (let t = 1; t <= scenario.config.turns; t++) {
    await store.hostStartTurn('1234', 600);
    for (const asset of buyable.slice(0, 2)) {
      try { await store.teamTrade(a.id, a.code, { asset: asset.id, side: 'buy', qty: 1 }); } catch { /* limity */ }
    }
    // stan „tura otwarta” — scenariusz odsłonięty
    let snap = store.getSnapshot();
    let full = replay(scenario, snap.teams, snap.events);
    let part = replay(reveal(scenario, 'open', t), snap.teams, snap.events);
    assert.deepEqual(ranking(reveal(scenario, 'open', t), part), ranking(scenario, full), `tura ${t} otwarta`);
    await store.hostCloseTurn('1234');
    snap = store.getSnapshot();
    const phase = snap.game.phase;
    full = replay(scenario, snap.teams, snap.events);
    const rs = reveal(scenario, phase, t);
    part = replay(rs, snap.teams, snap.events);
    assert.deepEqual(ranking(rs, part), ranking(scenario, full), `po zamknięciu tury ${t}`);
    assert.equal(part.phase, phase === 'finished' ? PHASE.FINISHED : PHASE.CLOSED);
  }
  store.close();
});
