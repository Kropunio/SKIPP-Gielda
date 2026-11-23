// Walidator i loader scenariusza (data/scenario.json). Bez zależności, działa w przeglądarce i w Node.
// Format opisany pole po polu w docs/SCENARIO.md.

export const ASSET_TYPES = ['cash', 'bond', 'index', 'stock', 'special'];
export const NEWS_SCOPES = ['global', 'biwak'];
const ID_RE = /^[a-z0-9_-]{1,32}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const hasMax2Decimals = (v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

/**
 * Sprawdza scenariusz. Zwraca { ok, errors: string[], warnings: string[] }.
 * Błędy blokują grę, ostrzeżenia (np. placeholdery "TODO") tylko informują.
 */
export function validateScenario(s, { partial = false } = {}) {
  // partial: scenariusz „odsłonięty” z serwera — kursy/stopy przyszłych tur mogą być null, zagadki bez haseł.
  const errors = [];
  const warnings = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);

  if (!isObj(s)) return { ok: false, errors: ['Scenariusz musi być obiektem JSON.'], warnings };

  // meta
  if (!isObj(s.meta)) err('meta', 'brak obiektu meta');
  else {
    if (!isStr(s.meta.title)) err('meta.title', 'wymagany niepusty tekst (tytuł gry)');
    if (s.meta.currency !== undefined && !isStr(s.meta.currency)) err('meta.currency', 'musi być tekstem, np. "zł"');
  }

  // config
  const c = s.config;
  let turns = 0;
  let months = 3;
  if (!isObj(c)) err('config', 'brak obiektu config');
  else {
    if (!isInt(c.turns) || c.turns < 1 || c.turns > 20) err('config.turns', 'liczba całkowita 1–20');
    else turns = c.turns;
    if (!isInt(c.turnSeconds) || c.turnSeconds < 10) err('config.turnSeconds', 'liczba całkowita sekund (min. 10)');
    if (!isInt(c.testTurnSeconds) || c.testTurnSeconds < 5) err('config.testTurnSeconds', 'liczba całkowita sekund (min. 5)');
    if (!isInt(c.monthsPerTurn) || c.monthsPerTurn < 1 || c.monthsPerTurn > 12) err('config.monthsPerTurn', 'liczba całkowita 1–12');
    else months = c.monthsPerTurn;
    if (!isNum(c.startCapital) || c.startCapital <= 0 || !hasMax2Decimals(c.startCapital)) err('config.startCapital', 'kwota > 0, maks. 2 miejsca po przecinku');
    if (!isNum(c.positionLimit) || c.positionLimit <= 0 || c.positionLimit > 1) err('config.positionLimit', 'ułamek w przedziale (0, 1], np. 0.4 = 40%');
    if (c.positionLimitExemptTypes !== undefined) {
      if (!Array.isArray(c.positionLimitExemptTypes) || c.positionLimitExemptTypes.some((t) => !ASSET_TYPES.includes(t)))
        err('config.positionLimitExemptTypes', `lista typów z: ${ASSET_TYPES.join(', ')}`);
    }
    if (!isNum(c.puzzleReward) || c.puzzleReward < 0 || !hasMax2Decimals(c.puzzleReward)) err('config.puzzleReward', 'kwota >= 0');
    if (c.rankingPlannedTurns !== undefined && (!Array.isArray(c.rankingPlannedTurns) || c.rankingPlannedTurns.some((t) => !isInt(t))))
      err('config.rankingPlannedTurns', 'lista numerów tur');
  }

  // assets
  const assetIds = new Set();
  if (!Array.isArray(s.assets) || s.assets.length === 0) err('assets', 'wymagana niepusta lista aktywów');
  else {
    let cashCount = 0;
    s.assets.forEach((a, i) => {
      const p = `assets[${i}]${a && a.id ? ` (${a.id})` : ''}`;
      if (!isObj(a)) return err(p, 'musi być obiektem');
      if (!isStr(a.id) || !ID_RE.test(a.id)) err(`${p}.id`, 'wymagane id: małe litery, cyfry, "_" lub "-", maks. 32 znaki');
      else if (assetIds.has(a.id)) err(`${p}.id`, `powtórzone id "${a.id}"`);
      else assetIds.add(a.id);
      if (!ASSET_TYPES.includes(a.type)) return err(`${p}.type`, `typ musi być jednym z: ${ASSET_TYPES.join(', ')}`);
      if (!isStr(a.name)) err(`${p}.name`, 'wymagana nazwa');
      if (a.type === 'cash') cashCount++;
      if (a.type === 'cash' || a.type === 'bond') {
        if (!Array.isArray(a.rates) || a.rates.length !== turns)
          err(`${p}.rates`, `wymagana lista ${turns} stóp (po jednej na turę), np. -0.015 = -1,5%`);
        else a.rates.forEach((r, j) => { if (partial && r === null) return; if (!isNum(r) || r <= -1 || r >= 1) err(`${p}.rates[${j}]`, 'stopa jako ułamek w przedziale (-1, 1)'); });
        if (a.prices !== undefined) err(`${p}.prices`, `typ ${a.type} nie ma kursów — użyj "rates"`);
      } else {
        if (!Array.isArray(a.prices) || a.prices.length !== turns + 1)
          err(`${p}.prices`, `wymagana lista ${turns + 1} kursów (tury 1–${turns} + wycena końcowa)`);
        else a.prices.forEach((v, j) => { if (partial && v === null) return; if (!isNum(v) || v < 0 || !hasMax2Decimals(v)) err(`${p}.prices[${j}]`, 'kurs >= 0, maks. 2 miejsca po przecinku'); });
      }
      for (const key of ['buyTurns', 'sellTurns']) {
        if (a[key] === undefined) continue;
        if (a.type === 'cash') err(`${p}.${key}`, 'gotówka nie ma ograniczeń handlu');
        else if (!Array.isArray(a[key]) || a[key].some((t) => !isInt(t) || t < 1 || t > turns))
          err(`${p}.${key}`, `lista numerów tur 1–${turns}`);
      }
      if (a.offer !== undefined && (!isObj(a.offer) || !isStr(a.offer.title) || typeof a.offer.body !== 'string'))
        err(`${p}.offer`, 'obiekt { title, body }');
    });
    if (cashCount !== 1) err('assets', `musi być dokładnie jedno aktywo typu "cash" (jest ${cashCount})`);
  }

  // turns
  if (!Array.isArray(s.turns) || s.turns.length !== turns) err('turns', `wymagana lista ${turns} tur (config.turns)`);
  if (Array.isArray(s.turns)) {
    s.turns.forEach((t, i) => {
      const p = `turns[${i}]`;
      if (!isObj(t)) return err(p, 'musi być obiektem');
      if (t.turn !== i + 1) err(`${p}.turn`, `oczekiwano ${i + 1}`);
      if (!isStr(t.label)) err(`${p}.label`, 'wymagana etykieta, np. "Kwartał 1"');
      if (!Array.isArray(t.news)) err(`${p}.news`, 'wymagana lista newsów (może być pusta)');
      else t.news.forEach((n, j) => {
        const q = `${p}.news[${j}]`;
        if (!isObj(n)) return err(q, 'musi być obiektem');
        if (!isStr(n.title)) err(`${q}.title`, 'wymagany tytuł');
        if (typeof n.body !== 'string') err(`${q}.body`, 'wymagana treść (tekst)');
        if (n.why !== undefined && typeof n.why !== 'string') err(`${q}.why`, 'musi być tekstem');
        if (n.asset !== undefined && !assetIds.has(n.asset)) err(`${q}.asset`, `nieznane aktywo "${n.asset}"`);
        if (n.scope !== undefined && !NEWS_SCOPES.includes(n.scope)) err(`${q}.scope`, `jedno z: ${NEWS_SCOPES.join(', ')}`);
      });
      if (t.summary !== undefined && typeof t.summary !== 'string') err(`${p}.summary`, 'musi być tekstem');
      if (!Array.isArray(t.months) || t.months.length !== months) err(`${p}.months`, `wymagana lista ${months} miesięcy (config.monthsPerTurn)`);
      else t.months.forEach((m, j) => {
        const q = `${p}.months[${j}]`;
        if (!isObj(m)) return err(q, 'musi być obiektem { name, event }');
        if (m.name !== undefined && typeof m.name !== 'string') err(`${q}.name`, 'musi być tekstem');
        if (m.event !== undefined && m.event !== null && (!isObj(m.event) || !isStr(m.event.title) || typeof m.event.body !== 'string'))
          err(`${q}.event`, 'null albo obiekt { title, body }');
      });
    });
  }

  // puzzles
  const puzzleIds = new Set();
  if (!Array.isArray(s.puzzles)) err('puzzles', 'wymagana lista zagadek (może być pusta)');
  else s.puzzles.forEach((z, i) => {
    const p = `puzzles[${i}]`;
    if (!isObj(z)) return err(p, 'musi być obiektem');
    if (!isStr(z.id) || !ID_RE.test(z.id)) err(`${p}.id`, 'wymagane id (małe litery, cyfry, "_" "-")');
    else if (puzzleIds.has(z.id)) err(`${p}.id`, `powtórzone id "${z.id}"`);
    else puzzleIds.add(z.id);
    if (!isStr(z.title)) err(`${p}.title`, 'wymagany tytuł');
    const answers = z.answers ?? [];
    const hashes = z.answerHashes ?? [];
    if (!Array.isArray(answers) || !Array.isArray(hashes)) err(p, '"answers" i "answerHashes" muszą być listami');
    else {
      if (!partial && answers.length + hashes.length === 0) err(p, 'wymagane co najmniej jedno hasło ("answers") lub hash ("answerHashes")');
      answers.forEach((a, j) => { if (!isStr(a) || normalizeAnswerForValidation(a) === '') err(`${p}.answers[${j}]`, 'hasło nie może być puste po normalizacji'); });
      hashes.forEach((h, j) => { if (typeof h !== 'string' || !/^[0-9a-fA-F]{64}$/.test(h)) err(`${p}.answerHashes[${j}]`, 'hash SHA-256 (64 znaki hex) znormalizowanego hasła'); });
    }
    if (z.reward !== undefined && (!isNum(z.reward) || z.reward < 0 || !hasMax2Decimals(z.reward))) err(`${p}.reward`, 'kwota >= 0');
  });

  // rules & glossary
  if (!Array.isArray(s.rules)) err('rules', 'wymagana lista sekcji zasad { title, body }');
  else s.rules.forEach((r, i) => { if (!isObj(r) || !isStr(r.title) || typeof r.body !== 'string') err(`rules[${i}]`, 'obiekt { title, body }'); });
  if (!Array.isArray(s.glossary)) err('glossary', 'wymagana lista haseł { term, definition }');
  else s.glossary.forEach((g, i) => { if (!isObj(g) || !isStr(g.term) || typeof g.definition !== 'string') err(`glossary[${i}]`, 'obiekt { term, definition }'); });

  // ostrzeżenia
  const todo = countTodos(s);
  if (todo > 0) warnings.push(`Scenariusz zawiera ${todo} placeholderów "TODO" — podmień treść przed grą.`);
  if (Array.isArray(s.assets)) {
    for (const a of s.assets) {
      if (Array.isArray(a?.buyTurns) && a.buyTurns.length === 0) warnings.push(`Aktywa "${a.id}" nie da się kupić w żadnej turze (buyTurns: []).`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function normalizeAnswerForValidation(s) {
  return String(s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function countTodos(v) {
  if (typeof v === 'string') return /TODO/.test(v) ? 1 : 0;
  if (Array.isArray(v)) return v.reduce((n, x) => n + countTodos(x), 0);
  if (isObj(v)) return Object.values(v).reduce((n, x) => n + countTodos(x), 0);
  return 0;
}

export class ScenarioError extends Error {
  constructor(errors) {
    super('Błędny scenariusz:\n- ' + errors.join('\n- '));
    this.errors = errors;
  }
}

/** Pobiera i waliduje scenariusz. Rzuca ScenarioError z listą czytelnych błędów. */
export async function loadScenario(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new ScenarioError([`Nie udało się pobrać ${url} (${e.message}). Uruchom stronę przez serwer HTTP, nie z pliku.`]);
  }
  if (!res.ok) throw new ScenarioError([`Nie udało się pobrać ${url} (HTTP ${res.status}).`]);
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new ScenarioError([`Plik ${url} nie jest poprawnym JSON-em: ${e.message}`]);
  }
  const v = validateScenario(json);
  if (!v.ok) throw new ScenarioError(v.errors);
  return { scenario: json, warnings: v.warnings };
}
