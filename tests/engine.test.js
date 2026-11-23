// Testy logiki gry: `node --test` (bez zależności).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { validateScenario } from '../js/scenario.js';
import { sha256Hex } from '../js/sha256.js';
import { formatMoney, formatPercent, csvMoney, parseMoneyInput, formatClock, NBSP } from '../js/format.js';
import {
  PHASE, replay, validateTrade, quoteTrade, maxBuyAmount, balanceBreakdown, ranking, turnClock, normalizeAnswer,
  checkPuzzleAnswer, puzzleHashes, priceIndexFor, portfolioTotal, getAsset, tradeCtx, turnContent, toGrosze, priceChange,
} from '../js/engine.js';
import { portfoliosCsv, transactionsCsv, BOM } from '../js/export.js';

const scenario = JSON.parse(readFileSync(new URL('../data/scenario.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------------ pomocnicze

function makeGame(teamNames = ['Alfa', 'Bravo']) {
  const teams = teamNames.map((name, i) => ({ id: `t${i + 1}`, name }));
  const events = [];
  let id = 0;
  let now = 1_700_000_000_000;
  const push = (type, teamId, payload, turn = null) => {
    const ev = { id: ++id, type, teamId, turn, at: now, payload };
    events.push(ev);
    now += 1000;
    return ev;
  };
  const g = {
    teams, events,
    state: () => replay(scenario, teams, events),
    start: (turn) => push('turn', null, { action: 'start', turn, duration: 600 }, turn),
    close: (turn) => push('turn', null, { action: 'close', turn }, turn),
    trade: (teamId, asset, side, qty) => push('trade', teamId, { asset, side, qty }, g.state().turn),
    puzzle: (teamId, puzzle) => push('puzzle', teamId, { puzzle }),
    adjust: (teamId, amount, note = '') => push('adjustment', teamId, { amount, note }),
    advance: (ms) => { now += ms; },
    result: (ev) => g.state().results.get(ev.id),
  };
  return g;
}

function assertConsistent(st) {
  for (const t of st.teams.values()) {
    const b = balanceBreakdown(scenario, t, st.priceIndex);
    assert.equal(b.sum, b.total, `rozpiska salda ${t.name}: suma ${b.sum} ≠ wartość ${b.total}`);
    assert.ok(b.consistent);
    assert.equal(b.total, portfolioTotal(scenario, t, st.priceIndex));
    for (const [id, q] of Object.entries(t.holdings)) assert.ok(q >= 0, `ujemna pozycja ${id}`);
    assert.ok(t.cash >= 0, 'ujemna gotówka bez korekt');
  }
}

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

// ------------------------------------------------------------------ format

describe('formatowanie', () => {
  test('kwoty po polsku', () => {
    assert.equal(formatMoney(123456), `1${NBSP}234,56${NBSP}zł`);
    assert.equal(formatMoney(5), `0,05${NBSP}zł`);
    assert.equal(formatMoney(-100000000), `-1${NBSP}000${NBSP}000,00${NBSP}zł`);
    assert.equal(formatMoney(1500, { sign: true }), `+15,00${NBSP}zł`);
    assert.equal(formatMoney(99, { noUnit: true }), '0,99');
  });
  test('procenty, CSV, parsowanie, zegar', () => {
    assert.equal(formatPercent(-0.015), '-1,5%');
    assert.equal(formatPercent(0.1234, { sign: true }), '+12,3%');
    assert.equal(formatPercent(0), '0,0%');
    assert.equal(csvMoney(123456), '1234,56');
    assert.equal(csvMoney(-5), '-0,05');
    assert.equal(parseMoneyInput('1 234,5'), 123450);
    assert.equal(parseMoneyInput('1234.56 zł'), 123456);
    assert.ok(Number.isNaN(parseMoneyInput('abc')));
    assert.ok(Number.isNaN(parseMoneyInput('1,234')));
    assert.equal(formatClock(65_000), '1:05');
    assert.equal(formatClock(0), '0:00');
  });
});

// ------------------------------------------------------------------ scenariusz

describe('walidator scenariusza', () => {
  test('placeholderowy scenariusz jest poprawny (z ostrzeżeniem o TODO)', () => {
    const v = validateScenario(scenario);
    assert.deepEqual(v.errors, []);
    assert.ok(v.ok);
    assert.ok(v.warnings.some((w) => w.includes('TODO')));
  });
  test('czytelne błędy dla zepsutego scenariusza', () => {
    const s = clone(scenario);
    s.config.turns = 5; // niezgodne z długością list
    s.assets.push({ id: 'cash', type: 'cash', name: 'Druga gotówka', rates: [0, 0, 0, 0, 0] });
    s.assets[2].prices[1] = 'dużo';
    s.turns[0].news[0].asset = 'nie-ma';
    s.puzzles[0].answers = ['   '];
    delete s.glossary;
    const v = validateScenario(s);
    assert.equal(v.ok, false);
    const all = v.errors.join('\n');
    assert.match(all, /turns: wymagana lista 5 tur/);
    assert.match(all, /powtórzone id "cash"/);
    assert.match(all, /dokładnie jedno aktywo typu "cash"/);
    assert.match(all, /prices/);
    assert.match(all, /nieznane aktywo "nie-ma"/);
    assert.match(all, /puzzles\[0\]\.answers\[0\]/);
    assert.match(all, /glossary/);
  });
  test('błędne typy i stopy', () => {
    const s = clone(scenario);
    s.assets[0].rates[0] = 2;
    s.assets[3].type = 'krypto';
    s.config.positionLimit = 40;
    const v = validateScenario(s);
    assert.match(v.errors.join('\n'), /rates\[0\]/);
    assert.match(v.errors.join('\n'), /typ musi być/);
    assert.match(v.errors.join('\n'), /positionLimit/);
  });
  test('nie-obiekt', () => {
    assert.equal(validateScenario(null).ok, false);
    assert.equal(validateScenario([]).ok, false);
  });
});

// ------------------------------------------------------------------ zagadki

describe('zagadki', () => {
  test('sha256 zgodne z node:crypto', () => {
    for (const s of ['', 'abc', 'zażółć gęślą jaźń', 'x'.repeat(200)]) {
      assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
  test('normalizacja hasła', () => {
    assert.equal(normalizeAnswer('  Zażółć  GĘŚLĄ jaźń! '), 'zazolcgeslajazn');
    assert.equal(normalizeAnswer('Łódź'), 'lodz');
    assert.equal(normalizeAnswer('Hasło-Jeden.'), 'haslojeden');
    assert.equal(normalizeAnswer('   '), '');
  });
  test('sprawdzanie haseł: answers i answerHashes', () => {
    const [z1, z2, , z4] = scenario.puzzles;
    assert.ok(checkPuzzleAnswer(z1, 'HASLO jeden'));
    assert.ok(checkPuzzleAnswer(z1, 'hasłojeden'));
    assert.ok(!checkPuzzleAnswer(z1, 'hasło dwa'));
    assert.ok(checkPuzzleAnswer(z2, 'Hasło 2'));
    assert.ok(checkPuzzleAnswer(z4, 'Tajne Hasło'));
    assert.ok(!checkPuzzleAnswer(z4, ''));
    assert.equal(puzzleHashes(z1).length, 1);
  });
  test('dotacja tylko raz na zespół', () => {
    const g = makeGame();
    const a = g.puzzle('t1', 'z1');
    const b = g.puzzle('t1', 'z1');
    const c = g.puzzle('t2', 'z1');
    const d = g.puzzle('t1', 'nie-ma');
    const st = g.state();
    assert.ok(st.results.get(a.id).ok);
    assert.equal(st.results.get(b.id).ok, false);
    assert.ok(st.results.get(c.id).ok);
    assert.equal(st.results.get(d.id).ok, false);
    assert.equal(st.teams.get('t1').cash, toGrosze(10000 + 500));
    assertConsistent(st);
  });
});

// ------------------------------------------------------------------ transakcje

describe('transakcje', () => {
  test('handel tylko w otwartej turze', () => {
    const g = makeGame();
    const pre = g.trade('t1', 'idx', 'buy', 1);
    g.start(1);
    const ok = g.trade('t1', 'idx', 'buy', 1);
    g.close(1);
    const post = g.trade('t1', 'idx', 'buy', 1);
    assert.equal(g.result(pre).ok, false);
    assert.ok(g.result(ok).ok);
    assert.equal(g.result(post).ok, false);
    assert.equal(g.state().teams.get('t1').holdings.idx, 1);
  });

  test('saldo, ilość, sprzedaż więcej niż posiadane', () => {
    const g = makeGame();
    g.start(1);
    const st = g.state();
    const t = st.teams.get('t1');
    assert.equal(validateTrade(scenario, t, { asset: 'idx', side: 'buy', qty: 0 }, tradeCtx(st)).ok, false);
    assert.equal(validateTrade(scenario, t, { asset: 'idx', side: 'buy', qty: 1.5 }, tradeCtx(st)).ok, false);
    assert.equal(validateTrade(scenario, t, { asset: 'idx', side: 'sell', qty: 1 }, tradeCtx(st)).ok, false);
    assert.equal(validateTrade(scenario, t, { asset: 'cash', side: 'buy', qty: 1 }, tradeCtx(st)).ok, false);
    assert.equal(validateTrade(scenario, t, { asset: 'xyz', side: 'buy', qty: 1 }, tradeCtx(st)).ok, false);
    assert.equal(validateTrade(scenario, t, { asset: 'idx', side: 'hold', qty: 1 }, tradeCtx(st)).ok, false);
  });

  test('limit pozycji 40% (gotówka zwolniona)', () => {
    const g = makeGame();
    g.start(1);
    const st = g.state();
    const t = st.teams.get('t1');
    const price = toGrosze(getAsset(scenario, 'idx').prices[0]);
    const max = maxBuyAmount(scenario, t, 'idx', tradeCtx(st));
    assert.ok(max <= 400000 && max > 400000 - price);
    const qtyMax = Math.floor(400000 / price);
    assert.ok(validateTrade(scenario, t, { asset: 'idx', side: 'buy', qty: qtyMax }, tradeCtx(st)).ok);
    const over = validateTrade(scenario, t, { asset: 'idx', side: 'buy', qty: qtyMax + 1 }, tradeCtx(st));
    assert.equal(over.ok, false);
    assert.match(over.error, /Limit pozycji/);
    // obligacje też podlegają limitowi
    assert.equal(validateTrade(scenario, t, { asset: 'bond', side: 'buy', qty: 400001 }, tradeCtx(st)).ok, false);
    assert.ok(validateTrade(scenario, t, { asset: 'bond', side: 'buy', qty: 400000 }, tradeCtx(st)).ok);
  });

  test('Pewniak: kupno tylko w turze 3, bez sprzedaży', () => {
    const g = makeGame();
    g.start(1);
    const e1 = g.trade('t1', 'pewniak', 'buy', 1);
    g.close(1); g.start(2); g.close(2); g.start(3);
    const e3 = g.trade('t1', 'pewniak', 'buy', 100);
    const s3 = g.trade('t1', 'pewniak', 'sell', 1);
    g.close(3); g.start(4);
    const e4 = g.trade('t1', 'pewniak', 'buy', 1);
    const s4 = g.trade('t1', 'pewniak', 'sell', 1);
    assert.equal(g.result(e1).ok, false);
    assert.ok(g.result(e3).ok);
    assert.equal(g.result(s3).ok, false);
    assert.equal(g.result(e4).ok, false);
    assert.equal(g.result(s4).ok, false);
    assertConsistent(g.state());
  });

  test('wycena zlecenia za kwotę i za ilość', () => {
    const g = makeGame();
    g.start(1);
    const st = g.state();
    const t = st.teams.get('t1');
    const price = toGrosze(getAsset(scenario, 'd01').prices[0]);
    const q = quoteTrade(scenario, t, { asset: 'd01', side: 'buy', mode: 'amount', value: price * 3 + 1 }, tradeCtx(st));
    assert.equal(q.qty, 3);
    assert.equal(q.amount, price * 3);
    assert.equal(q.cashAfter, t.cash - price * 3);
    assert.ok(q.ok);
    const q2 = quoteTrade(scenario, t, { asset: 'd01', side: 'buy', mode: 'qty', value: 2 }, tradeCtx(st));
    assert.equal(q2.amount, price * 2);
    const q3 = quoteTrade(scenario, t, { asset: 'bond', side: 'buy', mode: 'amount', value: 12345 }, tradeCtx(st));
    assert.equal(q3.qty, 12345);
    const q4 = quoteTrade(scenario, t, { asset: 'd01', side: 'buy', mode: 'amount', value: 1 }, tradeCtx(st));
    assert.equal(q4.ok, false);
  });

  test('dwa telefony jednego zespołu wydają tę samą gotówkę — druga transakcja odrzucona', () => {
    const g = makeGame();
    g.start(1);
    // 35% w d01 i 35% w d02 to razem 70% — obie OK; trzecia ponad gotówkę musi odpaść
    const p1 = toGrosze(getAsset(scenario, 'd01').prices[0]);
    const p2 = toGrosze(getAsset(scenario, 'd02').prices[0]);
    const p3 = toGrosze(getAsset(scenario, 'idx').prices[0]);
    const a = g.trade('t1', 'd01', 'buy', Math.floor(390000 / p1));
    const b = g.trade('t1', 'd02', 'buy', Math.floor(390000 / p2));
    const c = g.trade('t1', 'idx', 'buy', Math.floor(390000 / p3));
    const st = g.state();
    assert.ok(st.results.get(a.id).ok);
    assert.ok(st.results.get(b.id).ok);
    assert.equal(st.results.get(c.id).ok, false);
    assert.match(st.results.get(c.id).error, /gotówki/);
    assertConsistent(st);
  });

  test('transakcja po czasie tury odrzucona', () => {
    const g = makeGame();
    g.start(1);
    g.advance(600_000 + 10_000);
    const late = g.trade('t1', 'idx', 'buy', 1);
    assert.equal(g.result(late).ok, false);
    assert.match(g.result(late).error, /Czas tury/);
  });

  test('korekty prowadzącego (dotacja i potrącenie)', () => {
    const g = makeGame();
    g.adjust('t1', 25050, 'Za porządek');
    g.adjust('t1', -1000, 'Spóźnienie');
    const bad = g.adjust('t1', 0);
    const st = g.state();
    assert.equal(st.teams.get('t1').cash, 1_000_000 + 24050);
    assert.equal(g.result(bad).ok, false);
    const b = balanceBreakdown(scenario, st.teams.get('t1'), st.priceIndex);
    assert.equal(b.adjustments, 24050);
    assert.equal(b.adjustmentsList.length, 2);
    assertConsistent(st);
  });
});

// ------------------------------------------------------------------ tury

describe('tury i rozliczenie', () => {
  test('kolejność tur i fazy', () => {
    const g = makeGame();
    assert.equal(g.state().phase, PHASE.LOBBY);
    const bad = g.start(2);
    assert.equal(g.result(bad).ok, false);
    g.start(1);
    assert.equal(g.state().phase, PHASE.OPEN);
    const badClose = g.close(2);
    assert.equal(g.result(badClose).ok, false);
    g.close(1);
    assert.equal(g.state().phase, PHASE.CLOSED);
    assert.equal(g.state().priceIndex, 1);
    for (let t = 2; t <= 6; t++) { g.start(t); g.close(t); }
    const st = g.state();
    assert.equal(st.phase, PHASE.FINISHED);
    assert.equal(st.priceIndex, 6);
    assert.equal(st.history.length, 7);
    const again = g.start(7);
    assert.equal(g.result(again).ok, false);
  });

  test('priceIndexFor', () => {
    assert.equal(priceIndexFor('lobby', 0, 6), 0);
    assert.equal(priceIndexFor('open', 3, 6), 2);
    assert.equal(priceIndexFor('closed', 3, 6), 3);
    assert.equal(priceIndexFor('finished', 6, 6), 6);
  });

  test('inflacja na gotówce i odsetki od obligacji (kapitalizowane)', () => {
    const g = makeGame();
    g.start(1);
    g.trade('t1', 'bond', 'buy', 400000);
    g.close(1);
    const t = g.state().teams.get('t1');
    // gotówka 600 000 gr × -1,5% = -9 000; obligacje 400 000 × 1% = 4 000
    assert.equal(t.cash, 600000 - 9000);
    assert.equal(t.holdings.bond, 404000);
    const b = balanceBreakdown(scenario, t, 1);
    assert.equal(b.inflation, -9000);
    assert.equal(b.interest, 4000);
    assert.equal(b.assets.find((a) => a.id === 'bond').pl, 0);
    assertConsistent(g.state());
  });

  test('ujemna gotówka (po potrąceniu) nie jest „inflowana”', () => {
    const g = makeGame();
    g.adjust('t1', -2_000_000, 'test');
    g.start(1); g.close(1);
    assert.equal(g.state().teams.get('t1').cash, 1_000_000 - 2_000_000);
  });

  test('turnContent: newsy, podsumowanie poprzedniego kwartału, eventy do bieżącego miesiąca', () => {
    const c1 = turnContent(scenario, 1, 1);
    assert.equal(c1.previousSummary, '');
    assert.equal(c1.monthEvents.length, 0);
    const c2 = turnContent(scenario, 2, 2);
    assert.equal(c2.previousSummary, scenario.turns[0].summary);
    assert.equal(c2.monthEvents.length, 1);
    assert.equal(c2.turnData.news.length, scenario.turns[1].news.length);
  });

  test('priceChange', () => {
    const a = getAsset(scenario, 'idx');
    assert.equal(priceChange(a, 0), null);
    const ch = priceChange(a, 1);
    assert.equal(ch.cur, toGrosze(a.prices[1]));
    assert.equal(priceChange(getAsset(scenario, 'bond'), 1), null);
  });
});

// ------------------------------------------------------------------ zegar

describe('zegar', () => {
  test('tura 600 s, 3 miesiące po 200 s', () => {
    const s = 1000;
    let c = turnClock(s, 600, s + 10_000, 3);
    assert.equal(c.month, 1);
    assert.equal(c.remaining, 590_000);
    assert.equal(c.monthRemaining, 190_000);
    c = turnClock(s, 600, s + 250_000, 3);
    assert.equal(c.month, 2);
    c = turnClock(s, 600, s + 599_999, 3);
    assert.equal(c.month, 3);
    assert.equal(c.expired, false);
    c = turnClock(s, 600, s + 700_000, 3);
    assert.equal(c.expired, true);
    assert.equal(c.remaining, 0);
    assert.equal(c.month, 3);
  });
  test('tryb testowy 30 s', () => {
    const c = turnClock(0, 30, 10_001, 3);
    assert.equal(c.month, 2);
  });
  test('brak tury', () => {
    assert.equal(turnClock(null, 600, 0).running, false);
  });
});

// ------------------------------------------------------------------ symulacja pełnej gry

describe('symulacja pełnej gry', () => {
  const STRATEGIES = {
    gotowka: () => {},
    obligacje: (g, team) => {
      const st = g.state();
      const max = maxBuyAmount(scenario, st.teams.get(team), 'bond', tradeCtx(st));
      if (max > 0) g.trade(team, 'bond', 'buy', max);
    },
    indeks: (g, team) => {
      const st = g.state();
      const max = maxBuyAmount(scenario, st.teams.get(team), 'idx', tradeCtx(st));
      const price = toGrosze(getAsset(scenario, 'idx').prices[st.turn - 1]);
      if (max >= price) g.trade(team, 'idx', 'buy', Math.floor(max / price));
    },
    dywersyfikacja: (g, team) => {
      for (const id of ['idx', 'bond', 'd01', 'd05', 'd10', 'd20']) {
        const st = g.state();
        const t = st.teams.get(team);
        const a = getAsset(scenario, id);
        const max = Math.min(maxBuyAmount(scenario, t, id, tradeCtx(st)), 150000);
        if (a.type === 'bond') { if (max > 0) g.trade(team, id, 'buy', max); continue; }
        const price = toGrosze(a.prices[st.turn - 1]);
        if (max >= price) g.trade(team, id, 'buy', Math.floor(max / price));
      }
    },
    pewniak: (g, team) => {
      const st = g.state();
      if (st.turn !== 3) return;
      const max = maxBuyAmount(scenario, st.teams.get(team), 'pewniak', tradeCtx(st));
      const price = toGrosze(getAsset(scenario, 'pewniak').prices[2]);
      g.trade(team, 'pewniak', 'buy', Math.floor(max / price));
    },
    losowy: (g, team, r) => {
      const assets = scenario.assets.filter((a) => a.type !== 'cash');
      for (let i = 0; i < 8; i++) {
        const st = g.state();
        const t = st.teams.get(team);
        const a = assets[Math.floor(r() * assets.length)];
        const side = r() < 0.6 ? 'buy' : 'sell';
        // celowo czasem za dużo, żeby sprawdzić odrzucanie
        const held = t.holdings[a.id] || 0;
        const qty = a.type === 'bond'
          ? Math.max(1, Math.floor(r() * (side === 'buy' ? 600000 : held + 10000)))
          : Math.max(1, Math.floor(r() * (side === 'buy' ? 120 : held + 3)));
        g.trade(team, a.id, side, qty);
      }
    },
  };

  test('6 tur, kilka strategii: rozpiska salda co do grosza po każdym zdarzeniu', () => {
    const names = Object.keys(STRATEGIES);
    const g = makeGame(names);
    const r = rng(42);
    const teamOf = (name) => g.teams.find((t) => t.name === name).id;
    g.puzzle(teamOf('losowy'), 'z1');
    for (let turn = 1; turn <= 6; turn++) {
      g.start(turn);
      for (const name of names) STRATEGIES[name](g, teamOf(name), r);
      if (turn === 2) g.puzzle(teamOf('indeks'), 'z2');
      if (turn === 4) g.adjust(teamOf('gotowka'), 12345, 'nagroda za kreatywność');
      if (turn === 5) g.adjust(teamOf('pewniak'), -500, 'potrącenie');
      assertConsistent(g.state());
      g.close(turn);
      assertConsistent(g.state());
    }
    // rozpiska zgodna także dla każdego prefiksu listy zdarzeń
    for (let n = 1; n <= g.events.length; n++) {
      const st = replay(scenario, g.teams, g.events.slice(0, n));
      for (const t of st.teams.values()) {
        const b = balanceBreakdown(scenario, t, st.priceIndex);
        assert.equal(b.sum, b.total, `prefiks ${n}, ${t.name}`);
      }
    }
    const st = g.state();
    assert.equal(st.phase, PHASE.FINISHED);

    // gotówka: niezależne przeliczenie inflacji krok po kroku
    let cash = 1_000_000;
    scenario.assets[0].rates.forEach((rate, i) => {
      if (i === 3) cash += 12345; // korekta w turze 4 (przed zamknięciem)
      cash += Math.round(cash * rate);
    });
    assert.equal(st.teams.get(teamOf('gotowka')).cash, cash);
    assert.ok(cash < 1_000_000 + 12345, 'inflacja zjada gotówkę');

    // Pewniak kończy na 0 → strata
    const pew = balanceBreakdown(scenario, st.teams.get(teamOf('pewniak')), st.priceIndex);
    assert.ok(pew.assets.find((a) => a.id === 'pewniak').pl < 0);

    // losowy: były odrzucenia, ale stan spójny
    const rejected = st.trades.filter((t) => !t.ok).length;
    assert.ok(rejected > 0, 'losowa strategia powinna wygenerować odrzucone transakcje');

    // ranking: posortowany, wszystkie zespoły
    const rk = ranking(scenario, st);
    assert.equal(rk.length, names.length);
    for (let i = 1; i < rk.length; i++) assert.ok(rk[i - 1].total >= rk[i].total);
    assert.equal(rk[0].rank, 1);

    // determinizm: ponowny replay i kolejność zdarzeń z bazy (pomieszana) dają ten sam wynik
    const shuffled = [...g.events].sort(() => r() - 0.5);
    const st2 = replay(scenario, g.teams, shuffled);
    assert.deepEqual(ranking(scenario, st2), rk);
    assert.deepEqual(st2.history, st.history);

    // historia: snapshot startowy + 6 tur
    assert.equal(st.history.length, 7);
    assert.equal(st.history[0].teams[teamOf('gotowka')].total, 1_000_000);
  });

  test('eksport CSV: BOM, średniki, przecinek dziesiętny', () => {
    const g = makeGame(['Alfa', 'Bravo; "B"']);
    g.start(1);
    g.trade('t1', 'idx', 'buy', 10);
    g.trade('t2', 'idx', 'sell', 10); // odrzucona
    g.puzzle('t2', 'z1');
    g.close(1);
    g.start(2);
    const st = g.state();
    const p = portfoliosCsv(scenario, st);
    assert.ok(p.startsWith(BOM));
    const lines = p.slice(1).trim().split('\r\n');
    assert.match(lines[0], /^Tura;Moment;Zespół;Gotówka;/);
    // nagłówek + (start + po turze 1 + bieżący) × 2 zespoły
    assert.equal(lines.length, 1 + 3 * 2);
    assert.ok(lines.some((l) => l.includes('10000,00')));
    assert.ok(lines.some((l) => l.includes('"Bravo; ""B"""')));
    const t = transactionsCsv(scenario, st);
    assert.ok(t.startsWith(BOM));
    const tl = t.slice(1).trim().split('\r\n');
    assert.match(tl[0], /^Lp;Czas;Tura;Zespół;Rodzaj;/);
    assert.ok(tl.some((l) => l.includes('odrzucona')));
    assert.ok(tl.some((l) => l.includes('zagadka')));
    assert.ok(tl.some((l) => l.includes('inflacja')));
    assert.ok(!/\d\.\d\d;/.test(t), 'bez kropki dziesiętnej');
  });
});
