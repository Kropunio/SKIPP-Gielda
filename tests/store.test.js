// Test LocalStore w Node (pamięciowy localStorage) — pełny przepływ prowadzący + zespoły + replay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalStore, scenarioPuzzleHashes } from '../js/store.js';
import { replay, balanceBreakdown, normalizeAnswer, PHASE } from '../js/engine.js';

const scenario = JSON.parse(readFileSync(new URL('../data/scenario.json', import.meta.url), 'utf8'));

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

test('LocalStore: przepływ gry i walidacja po stronie „serwera”', async () => {
  const storage = new MemStorage();
  const store = new LocalStore('test', storage);
  await store.init();
  const b = new LocalStore('test', storage); // druga „karta”
  await b.init();
  let notified = 0;
  b.subscribe(() => notified++);
  try {
    await store.hostSetup('1234', 6);
    await assert.rejects(store.hostSetup('9999'), /już istnieje/);
    await assert.rejects(store.hostCheck('0000'), /PIN/);
    assert.equal(await store.hostCheck('1234'), true);
    await store.hostSyncScenario('1234', scenario);

    const alfa = await store.hostCreateTeam('1234', 'Alfa');
    const bravo = await store.hostCreateTeam('1234', 'Bravo');
    assert.match(alfa.code, /^\d{6}$/);
    await assert.rejects(store.hostCreateTeam('1234', ' alfa '), /już istnieje/);
    await assert.rejects(store.teamLogin('Alfa', alfa.code === '0000' ? '1111' : '0000'), /kod/);
    const who = await store.teamLogin(' alfa ', alfa.code);
    assert.equal(who.id, alfa.id);

    await assert.rejects(store.teamTrade(alfa.id, alfa.code, { asset: 'idx', side: 'buy', qty: 1 }), /zamknięty/);
    assert.equal(await store.hostStartTurn('1234', 600), 1);
    await assert.rejects(store.hostStartTurn('1234', 600), /Nie można/);
    await assert.rejects(store.teamTrade(alfa.id, bravo.code === alfa.code ? 'xxxx' : bravo.code, { asset: 'idx', side: 'buy', qty: 1 }), /kod/);
    const tid = await store.teamTrade(alfa.id, alfa.code, { asset: 'idx', side: 'buy', qty: 10 });
    const bad = await store.teamTrade(bravo.id, bravo.code, { asset: 'idx', side: 'sell', qty: 10 }); // brak pozycji → odrzucone w replay

    assert.equal(await store.teamPuzzle(alfa.id, alfa.code, 'z1', normalizeAnswer('zle')), 'wrong');
    assert.equal(await store.teamPuzzle(alfa.id, alfa.code, 'z1', normalizeAnswer('Hasło Jeden')), 'ok');
    assert.equal(await store.teamPuzzle(alfa.id, alfa.code, 'z1', normalizeAnswer('Hasło Jeden')), 'already');
    assert.equal(await store.teamPuzzle(bravo.id, bravo.code, 'z4', normalizeAnswer('tajne hasło')), 'ok');
    await store.hostAdjust('1234', bravo.id, -1000, 'test');
    await store.hostSetFlags('1234', { rankingVisible: true });
    assert.equal(await store.hostCloseTurn('1234'), 'closed');

    await new Promise((r) => setTimeout(r, 50)); // BroadcastChannel jest asynchroniczny
    const snap = b.getSnapshot(); // druga karta widzi to samo
    assert.ok(notified > 0);
    assert.equal(snap.game.rankingVisible, true);
    const st = replay(scenario, snap.teams, snap.events);
    assert.equal(st.phase, PHASE.CLOSED);
    assert.ok(st.results.get(tid).ok);
    assert.equal(st.results.get(bad).ok, false);
    for (const t of st.teams.values()) assert.ok(balanceBreakdown(scenario, t, st.priceIndex).consistent);
    assert.equal(st.teams.get(alfa.id).holdings.idx, 10);

    const newCode = await store.hostRegenCode('1234', alfa.id);
    await assert.rejects(store.teamTrade(alfa.id, alfa.code === newCode ? 'x' : alfa.code, { asset: 'idx', side: 'buy', qty: 1 }), /kod/);

    await store.hostReset('1234', { keepTeams: true, testMode: true });
    const s2 = store.getSnapshot();
    assert.equal(s2.events.length, 0);
    assert.equal(s2.teams.length, 2);
    assert.equal(s2.game.testMode, true);
    assert.equal(s2.game.phase, 'lobby');
    await store.hostDeleteTeam('1234', bravo.id);
    assert.equal(store.getSnapshot().teams.length, 1);
    assert.deepEqual(Object.keys(scenarioPuzzleHashes(scenario)), scenario.puzzles.map((p) => p.id));
  } finally {
    store.close();
    b.close();
  }
});
