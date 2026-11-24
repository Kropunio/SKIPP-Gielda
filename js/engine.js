// Czysta logika gry — bez I/O, bez DOM. Stan gry = replay(scenariusz, zespoły, zdarzenia).
// Wszystkie kwoty w groszach (liczby całkowite), dzięki czemu rozpiska salda zgadza się co do grosza.
//
// Zdarzenie (event): { id, type, teamId?, turn?, at (ms), payload }
//   type 'turn'       payload { action: 'start', turn, duration }  |  { action: 'close', turn }
//   type 'trade'      payload { asset, side: 'buy'|'sell', qty }   (qty: sztuki; dla obligacji: grosze)
//   type 'puzzle'     payload { puzzle }
//   type 'adjustment' payload { amount (grosze, ±), note }

import { sha256Hex } from './sha256.js';

export const PHASE = Object.freeze({ LOBBY: 'lobby', OPEN: 'open', CLOSED: 'closed', FINISHED: 'finished' });
export const UNIT_TYPES = ['index', 'stock', 'special'];
/** Tolerancja na opóźnienie sieci przy sprawdzaniu terminu tury (ms). */
export const GRACE_MS = 3000;

// ---------------------------------------------------------------- pomocnicze

export const toGrosze = (zl) => Math.round(Number(zl) * 100);
export const isUnitAsset = (a) => UNIT_TYPES.includes(a.type);

const assetCache = new WeakMap();
export function assetMap(scenario) {
  let m = assetCache.get(scenario);
  if (!m) {
    m = new Map(scenario.assets.map((a) => [a.id, a]));
    assetCache.set(scenario, m);
  }
  return m;
}
export const getAsset = (scenario, id) => assetMap(scenario).get(id);
export const cashAsset = (scenario) => scenario.assets.find((a) => a.type === 'cash');
export const tradableAssets = (scenario) => scenario.assets.filter((a) => a.type !== 'cash');
export const totalTurns = (scenario) => scenario.config.turns;
export const startCapital = (scenario) => toGrosze(scenario.config.startCapital);
export const puzzleReward = (scenario, p) => toGrosze(p.reward ?? scenario.config.puzzleReward);

/**
 * Indeks kursu obowiązującego w danej fazie:
 * lobby → 0 (kursy tury 1), tura n otwarta → n-1, po zamknięciu tury n → n (kursy tury n+1), koniec → turns (wycena końcowa).
 */
export function priceIndexFor(phase, turn, turns) {
  if (phase === PHASE.LOBBY) return 0;
  if (phase === PHASE.OPEN) return turn - 1;
  if (phase === PHASE.FINISHED) return turns;
  return Math.min(turn, turns);
}

/** Kurs aktywa w groszach (dla obligacji/gotówki: 1 grosz za „jednostkę”). */
export function priceOf(asset, idx) {
  if (!isUnitAsset(asset)) return 1;
  return toGrosze(asset.prices[idx]);
}

export function valueOf(asset, qty, idx) {
  return isUnitAsset(asset) ? qty * priceOf(asset, idx) : qty;
}

/** Stopa (gotówka/obligacje) stosowana na koniec tury `turn`. */
export function rateOf(asset, turn) {
  return asset.rates ? asset.rates[turn - 1] ?? 0 : 0;
}

/** Zmiana kursu względem poprzedniego indeksu: { prev, cur, change (ułamek) } lub null. */
export function priceChange(asset, idx) {
  if (!isUnitAsset(asset) || idx <= 0) return null;
  const prev = priceOf(asset, idx - 1);
  const cur = priceOf(asset, idx);
  return { prev, cur, change: prev > 0 ? (cur - prev) / prev : null };
}

export const canBuyInTurn = (asset, turn) => asset.type !== 'cash' && (!asset.buyTurns || asset.buyTurns.includes(turn));
export const canSellInTurn = (asset, turn) => asset.type !== 'cash' && (!asset.sellTurns || asset.sellTurns.includes(turn));

// ---------------------------------------------------------------- stan zespołu

export function newTeamState(scenario, team) {
  return {
    id: team.id,
    name: team.name,
    cash: startCapital(scenario),
    holdings: {},
    ledger: { inflation: 0, interest: 0, puzzles: 0, adjustments: 0, adjustmentsList: [], assets: {} },
    solved: {},
    log: [],
  };
}

function ledgerAsset(team, id) {
  return (team.ledger.assets[id] ??= { bought: 0, sold: 0, interest: 0 });
}

/** Wycena portfela przy danym indeksie kursów. */
export function portfolio(scenario, team, idx) {
  const positions = [];
  let total = team.cash;
  for (const a of tradableAssets(scenario)) {
    const qty = team.holdings[a.id] || 0;
    if (!qty) continue;
    const value = valueOf(a, qty, idx);
    total += value;
    positions.push({ asset: a, qty, price: priceOf(a, idx), value });
  }
  return { cash: team.cash, positions, total };
}

export const portfolioTotal = (scenario, team, idx) => portfolio(scenario, team, idx).total;

// ---------------------------------------------------------------- transakcje

/**
 * Walidacja transakcji. ctx = { phase, turn }.
 * Zwraca { ok, error?, amount (grosze), price, maxBuy? }.
 */
export function validateTrade(scenario, team, trade, ctx) {
  const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
  const a = getAsset(scenario, trade.asset);
  if (!a) return fail('Nieznane aktywo.');
  if (a.type === 'cash') return fail(`${a.name} to gotówka — nią się płaci, nie handluje.`);
  if (ctx.phase !== PHASE.OPEN) return fail('Handel jest teraz zamknięty.');
  if (trade.turn != null && trade.turn !== ctx.turn) return fail('Transakcja dotyczy innej tury.');
  if (trade.side !== 'buy' && trade.side !== 'sell') return fail('Nieznany rodzaj transakcji.');
  const qty = trade.qty;
  if (!Number.isSafeInteger(qty) || qty <= 0) return fail(isUnitAsset(a) ? 'Ilość musi być dodatnią liczbą całkowitą.' : 'Kwota musi być większa od zera.');
  const idx = ctx.turn - 1;
  const price = priceOf(a, idx);
  const amount = isUnitAsset(a) ? qty * price : qty;

  if (trade.side === 'buy') {
    if (!canBuyInTurn(a, ctx.turn)) return fail(`${a.name}: kupno niedostępne w tej turze.`);
    if (price <= 0) return fail(`${a.name}: brak kursu — nie można kupić.`);
    if (amount > team.cash) return fail('Za mało gotówki.', { amount, price });
    const limit = scenario.config.positionLimit;
    const exempt = scenario.config.positionLimitExemptTypes ?? ['cash'];
    if (!exempt.includes(a.type)) {
      const total = portfolioTotal(scenario, team, idx);
      const posValue = valueOf(a, team.holdings[a.id] || 0, idx);
      const maxBuy = Math.max(0, Math.floor(total * limit) - posValue);
      if (amount > maxBuy) {
        return fail(`Limit pozycji: jedno aktywo może stanowić maks. ${Math.round(limit * 100)}% wartości portfela.`, { amount, price, maxBuy });
      }
    }
  } else {
    if (!canSellInTurn(a, ctx.turn)) return fail(`${a.name}: sprzedaż niedostępna w tej turze.`);
    if (qty > (team.holdings[a.id] || 0)) return fail(isUnitAsset(a) ? 'Nie masz tylu jednostek.' : 'Nie masz tyle w tym aktywie.', { amount, price });
  }
  return { ok: true, amount, price };
}

/** Maksymalna kwota zakupu (grosze) możliwa teraz — uwzględnia gotówkę i limit pozycji. */
export function maxBuyAmount(scenario, team, assetId, ctx) {
  const a = getAsset(scenario, assetId);
  if (!a || a.type === 'cash' || ctx.phase !== PHASE.OPEN || !canBuyInTurn(a, ctx.turn)) return 0;
  const idx = ctx.turn - 1;
  let max = Math.max(0, team.cash);
  const exempt = scenario.config.positionLimitExemptTypes ?? ['cash'];
  if (!exempt.includes(a.type)) {
    const total = portfolioTotal(scenario, team, idx);
    const posValue = valueOf(a, team.holdings[a.id] || 0, idx);
    max = Math.min(max, Math.max(0, Math.floor(total * scenario.config.positionLimit) - posValue));
  }
  if (isUnitAsset(a)) {
    const price = priceOf(a, idx);
    return price > 0 ? Math.floor(max / price) * price : 0;
  }
  return max;
}

/**
 * Wycena zlecenia z formularza: input = { asset, side, mode: 'amount'|'qty', value }.
 * mode 'amount': value w groszach → ilość = floor(kwota / kurs). mode 'qty': value = sztuki.
 * Dla obligacji zawsze kwota. Zwraca { qty, amount, price, ok, error, cashAfter }.
 */
export function quoteTrade(scenario, team, input, ctx) {
  const a = getAsset(scenario, input.asset);
  if (!a) return { ok: false, error: 'Nieznane aktywo.', qty: 0, amount: 0 };
  const idx = Math.max(0, ctx.turn - 1);
  const price = priceOf(a, idx);
  let qty;
  if (!isUnitAsset(a) || input.mode === 'amount') {
    qty = isUnitAsset(a) ? (price > 0 ? Math.floor(input.value / price) : 0) : Math.round(input.value);
  } else {
    qty = Math.round(input.value);
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    const msg = isUnitAsset(a) && input.mode === 'amount' && input.value > 0 ? 'Kwota mniejsza niż kurs jednej jednostki.' : 'Podaj kwotę lub ilość.';
    return { ok: false, error: msg, qty: 0, amount: 0, price };
  }
  const v = validateTrade(scenario, team, { asset: a.id, side: input.side, qty }, ctx);
  const amount = isUnitAsset(a) ? qty * price : qty;
  const cashAfter = input.side === 'buy' ? team.cash - amount : team.cash + amount;
  return { ...v, qty, amount, price, cashAfter };
}

function applyTrade(scenario, team, trade, amount) {
  const a = getAsset(scenario, trade.asset);
  const led = ledgerAsset(team, a.id);
  if (trade.side === 'buy') {
    team.cash -= amount;
    team.holdings[a.id] = (team.holdings[a.id] || 0) + trade.qty;
    led.bought += amount;
  } else {
    team.cash += amount;
    team.holdings[a.id] = (team.holdings[a.id] || 0) - trade.qty;
    led.sold += amount;
  }
}

/** Rozliczenie końca tury: inflacja na gotówce (tylko dodatnie saldo), odsetki od obligacji (kapitalizowane). */
function settleTeam(scenario, team, turn, at) {
  const cashA = cashAsset(scenario);
  const rate = rateOf(cashA, turn);
  const infl = team.cash > 0 ? Math.round(team.cash * rate) : 0;
  if (infl !== 0) {
    team.cash += infl;
    team.ledger.inflation += infl;
  }
  team.log.push({ kind: 'inflation', turn, at, ok: true, amount: infl, rate, asset: cashA.id });
  for (const a of scenario.assets) {
    if (a.type !== 'bond') continue;
    const held = team.holdings[a.id] || 0;
    if (!held) continue;
    const r = rateOf(a, turn);
    const interest = Math.round(held * r);
    if (interest !== 0) {
      team.holdings[a.id] = held + interest;
      team.ledger.interest += interest;
      ledgerAsset(team, a.id).interest += interest;
    }
    team.log.push({ kind: 'interest', turn, at, ok: true, amount: interest, rate: r, asset: a.id });
  }
}

// ---------------------------------------------------------------- zagadki

/** Normalizacja hasła: małe litery, bez polskich znaków, bez spacji i interpunkcji. */
export function normalizeAnswer(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export const hashAnswer = (s) => sha256Hex(normalizeAnswer(s));

/** Zestaw dozwolonych hashy dla zagadki (z "answers" i "answerHashes"). */
export function puzzleHashes(puzzle) {
  const out = new Set();
  for (const a of puzzle.answers ?? []) out.add(hashAnswer(a));
  for (const h of puzzle.answerHashes ?? []) out.add(String(h).toLowerCase());
  return [...out];
}

export function checkPuzzleAnswer(puzzle, input) {
  const n = normalizeAnswer(input);
  if (!n) return false;
  return puzzleHashes(puzzle).includes(sha256Hex(n));
}

// ---------------------------------------------------------------- replay (event sourcing)

function snapshot(scenario, st, at) {
  const idx = priceIndexFor(st.phase, st.turn, totalTurns(scenario));
  const teams = {};
  for (const [id, t] of st.teams) {
    teams[id] = { cash: t.cash, holdings: { ...t.holdings }, total: portfolioTotal(scenario, t, idx) };
  }
  return { turn: st.turn, phase: st.phase, priceIndex: idx, at, teams };
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const x = Number(a.id), y = Number(b.id);
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
    return 0;
  });
}

/**
 * Deterministyczne odtworzenie stanu gry.
 * teams: [{ id, name }], events: [{ id, type, teamId, turn, at, payload }].
 * Zdarzenia niepoprawne (np. dwa telefony wydały tę samą gotówkę) są odrzucane — wynik w `results`.
 */
export function replay(scenario, teams, events) {
  const turns = totalTurns(scenario);
  const st = {
    phase: PHASE.LOBBY,
    turn: 0,
    turnStartedAt: null,
    turnDuration: null,
    teams: new Map(),
    results: new Map(),
    history: [],
    trades: [],
    lastEventId: null,
  };
  for (const t of teams) st.teams.set(t.id, newTeamState(scenario, t));
  st.history.push(snapshot(scenario, st, null));
  const puzzles = new Map((scenario.puzzles ?? []).map((p) => [p.id, p]));

  const result = (ev, ok, error) => st.results.set(ev.id, ok ? { ok: true } : { ok: false, error });

  for (const ev of sortEvents(events)) {
    st.lastEventId = ev.id;
    const p = ev.payload || {};
    if (ev.type === 'turn') {
      if (p.action === 'start') {
        const valid = (st.phase === PHASE.LOBBY && p.turn === 1) || (st.phase === PHASE.CLOSED && p.turn === st.turn + 1);
        if (!valid || p.turn > turns) { result(ev, false, 'Nieprawidłowa kolejność tur.'); continue; }
        st.phase = PHASE.OPEN;
        st.turn = p.turn;
        st.turnStartedAt = ev.at;
        st.turnDuration = p.duration;
        result(ev, true);
      } else if (p.action === 'close') {
        if (st.phase !== PHASE.OPEN || p.turn !== st.turn) { result(ev, false, 'Nie ma otwartej tury do zamknięcia.'); continue; }
        for (const t of st.teams.values()) settleTeam(scenario, t, st.turn, ev.at);
        st.phase = st.turn >= turns ? PHASE.FINISHED : PHASE.CLOSED;
        st.turnStartedAt = null;
        st.history.push(snapshot(scenario, st, ev.at));
        result(ev, true);
      } else result(ev, false, 'Nieznana akcja tury.');
      continue;
    }

    const team = st.teams.get(ev.teamId);
    if (!team) { result(ev, false, 'Nieznany zespół.'); continue; }

    if (ev.type === 'trade') {
      const trade = { asset: p.asset, side: p.side, qty: p.qty, turn: ev.turn ?? p.turn };
      let v;
      if (st.phase === PHASE.OPEN && st.turnStartedAt != null && ev.at != null && st.turnDuration != null &&
          ev.at > st.turnStartedAt + st.turnDuration * 1000 + GRACE_MS) {
        v = { ok: false, error: 'Czas tury minął.' };
      } else {
        v = validateTrade(scenario, team, trade, { phase: st.phase, turn: st.turn });
      }
      if (v.ok) applyTrade(scenario, team, trade, v.amount);
      const entry = { kind: 'trade', eventId: ev.id, at: ev.at, turn: trade.turn ?? st.turn, ok: v.ok, error: v.error,
        asset: p.asset, side: p.side, qty: p.qty, price: v.price ?? null, amount: v.amount ?? null, cashAfter: team.cash, teamId: team.id };
      team.log.push(entry);
      st.trades.push(entry);
      result(ev, v.ok, v.error);
    } else if (ev.type === 'puzzle') {
      const pz = puzzles.get(p.puzzle);
      let error = null;
      if (!pz) error = 'Nieznana zagadka.';
      else if (team.solved[pz.id]) error = 'Zagadka już rozwiązana przez zespół.';
      else if (st.phase === PHASE.FINISHED) error = 'Gra zakończona.';
      if (!error) {
        const amt = puzzleReward(scenario, pz);
        team.cash += amt;
        team.ledger.puzzles += amt;
        team.solved[pz.id] = ev.at ?? true;
        team.log.push({ kind: 'puzzle', eventId: ev.id, at: ev.at, turn: st.turn, ok: true, puzzle: pz.id, amount: amt });
      }
      result(ev, !error, error);
    } else if (ev.type === 'adjustment') {
      const amt = p.amount;
      if (!Number.isSafeInteger(amt) || amt === 0) { result(ev, false, 'Nieprawidłowa kwota korekty.'); continue; }
      team.cash += amt;
      team.ledger.adjustments += amt;
      team.ledger.adjustmentsList.push({ amount: amt, note: p.note || '', at: ev.at, turn: st.turn });
      team.log.push({ kind: 'adjustment', eventId: ev.id, at: ev.at, turn: st.turn, ok: true, amount: amt, note: p.note || '' });
      result(ev, true);
    } else {
      result(ev, false, 'Nieznany typ zdarzenia.');
    }
  }
  st.priceIndex = priceIndexFor(st.phase, st.turn, turns);
  return st;
}

/** Kontekst handlu wynikający ze stanu. */
export const tradeCtx = (st) => ({ phase: st.phase, turn: st.turn });

// ---------------------------------------------------------------- rozpiska salda i ranking

/**
 * „Skąd się wzięło moje saldo”: kapitał startowy + inflacja + odsetki + zysk/strata per aktywo
 * + dotacje za zagadki + korekty prowadzącego = wartość portfela (co do grosza).
 */
export function balanceBreakdown(scenario, team, idx) {
  const start = startCapital(scenario);
  const assets = [];
  let plSum = 0;
  for (const a of tradableAssets(scenario)) {
    const led = team.ledger.assets[a.id] || { bought: 0, sold: 0, interest: 0 };
    const qty = team.holdings[a.id] || 0;
    const value = valueOf(a, qty, idx);
    if (!led.bought && !led.sold && !value) continue;
    const pl = value + led.sold - led.bought - led.interest;
    plSum += pl;
    assets.push({ id: a.id, name: a.name, type: a.type, qty, value, bought: led.bought, sold: led.sold, interest: led.interest, pl });
  }
  const { inflation, interest, puzzles, adjustments, adjustmentsList } = team.ledger;
  const total = portfolioTotal(scenario, team, idx);
  const sum = start + inflation + interest + plSum + puzzles + adjustments;
  return { start, inflation, interest, assets, plSum, puzzles, adjustments, adjustmentsList, total, sum, consistent: sum === total };
}

/** Ranking: [{ teamId, name, total, rank }] malejąco po wartości portfela (remisy dzielą miejsce). */
export function ranking(scenario, st, idx = st.priceIndex) {
  const rows = [...st.teams.values()].map((t) => ({ teamId: t.id, name: t.name, total: portfolioTotal(scenario, t, idx) }));
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pl'));
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1; });
  return rows;
}

/**
 * Historia wartości portfeli po turach (grosze): { labels, teams: [{ id, name, values }] }.
 * Punkty: start (tura 0) i zamknięcia tur z historii. W otwartej turze dodatkowy punkt „teraz”
 * (wycena po bieżących kursach, bez zapisu do historii).
 */
export function wealthSeries(scenario, st) {
  const snaps = st.history.map((h) => ({ turn: h.turn, teams: h.teams }));
  if (st.phase === PHASE.OPEN) {
    const idx = priceIndexFor(st.phase, st.turn, totalTurns(scenario));
    const teams = {};
    for (const [id, t] of st.teams) teams[id] = { total: portfolioTotal(scenario, t, idx) };
    snaps.push({ turn: st.turn, teams, current: true });
  }
  const labels = snaps.map((s) => (s.current ? 'teraz' : s.turn === 0 ? 'Start' : `K${s.turn}`));
  const teams = [...st.teams.values()].map((t) => ({
    id: t.id,
    name: t.name,
    values: snaps.map((s) => s.teams[t.id]?.total ?? null),
  }));
  return { labels, teams };
}

// ---------------------------------------------------------------- zegar

/**
 * Zegar tury. Długość miesiąca = długość tury / monthsPerTurn.
 * Zwraca { running, elapsed, remaining, expired, month, monthRemaining, monthLength, duration }.
 */
export function turnClock(startedAt, durationSec, now, monthsPerTurn = 3) {
  if (startedAt == null || !durationSec) return { running: false, elapsed: 0, remaining: 0, expired: false, month: 0, monthRemaining: 0, monthLength: 0, duration: 0 };
  const duration = durationSec * 1000;
  const elapsed = Math.min(duration, Math.max(0, now - startedAt));
  const monthLength = duration / monthsPerTurn;
  const month = Math.min(monthsPerTurn, Math.floor(elapsed / monthLength) + 1);
  return {
    running: true,
    elapsed,
    remaining: duration - elapsed,
    expired: now >= startedAt + duration,
    month,
    monthRemaining: Math.max(0, month * monthLength - elapsed),
    monthLength,
    duration,
  };
}

/** Teksty tury: { turnData, previousSummary, monthEvents (do bieżącego miesiąca) }. */
export function turnContent(scenario, turn, month = null) {
  const turnData = scenario.turns[turn - 1] || null;
  const prev = turn > 1 ? scenario.turns[turn - 2] : null;
  const months = turnData ? turnData.months : [];
  const upTo = month == null ? months.length : month;
  const monthEvents = months.slice(0, upTo).map((m, i) => ({ month: i + 1, name: m.name, event: m.event || null })).filter((m) => m.event);
  return { turnData, previousSummary: prev ? prev.summary || '' : '', previousLabel: prev ? prev.label : '', monthEvents };
}
