// Magazyn stanu gry. Dwie implementacje o wspólnym interfejsie:
//  - LocalStore    — localStorage + BroadcastChannel (kilka kart jednej przeglądarki; development i test offline)
//  - SupabaseStore — tabele + funkcje RPC + realtime (gra na wielu urządzeniach)
//
// Wspólny interfejs:
//   mode, label, init(), getSnapshot() → { game, teams, events }, subscribe(fn) → unsubscribe, now(), status
//   hostSetup(pin)* hostCheck(pin) hostSyncScenario(pin, scenario) hostReset(pin, { keepTeams, testMode })
//   hostCreateTeam(pin, name) → { id, name, code }  hostRegenCode(pin, teamId) → code  hostDeleteTeam(pin, teamId)
//   hostStartTurn(pin, duration) hostCloseTurn(pin) hostSetFlags(pin, { rankingVisible, testMode })
//   hostAdjust(pin, teamId, amountGrosze, note)
//   teamLogin(name, code) → { id, name }  teamTrade(teamId, code, { asset, side, qty })
//   teamPuzzle(teamId, code, puzzleId, normalizedAnswer) → 'ok' | 'wrong' | 'already'
//   (* hostSetup tylko w LocalStore — w Supabase grę zakłada admin_init_game w SQL Editorze)
//
// Zdarzenie: { id: number, type, teamId, turn, at: ms, payload }.
// Gra:       { id, phase, turn, totalTurns, turnStartedAt: ms|null, turnDuration, rankingVisible, testMode, rev }.

import { CONFIG, isSupabaseConfigured } from './config.js';
import { sha256Hex } from './sha256.js';
import { puzzleHashes, GRACE_MS } from './engine.js';

const CODE_RE = /^\d{4,8}$/;
const ID_RE = /^[a-z0-9_-]{1,32}$/;

export class StoreError extends Error {}

function randomCode() {
  const buf = new Uint32Array(1);
  (globalThis.crypto || { getRandomValues: (b) => { b[0] = Math.floor(Math.random() * 2 ** 32); return b; } }).getRandomValues(buf);
  return String(buf[0] % 1000000).padStart(6, '0');
}
function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

/** Hashe haseł zagadek do wysłania na serwer: { id: [sha256, ...] }. */
export function scenarioPuzzleHashes(scenario) {
  const out = {};
  for (const p of scenario.puzzles ?? []) out[p.id] = puzzleHashes(p);
  return out;
}

/**
 * Scenariusz do wgrania na serwer (tryb Supabase): bez jawnych haseł — zagadki mają tylko answerHashes.
 * Serwer sam odsłania klientom kursy i newsy kolejnych tur (get_scenario).
 */
export function scenarioForUpload(scenario) {
  const out = JSON.parse(JSON.stringify(scenario));
  out.puzzles = (scenario.puzzles ?? []).map(({ answers, ...rest }) => ({ ...rest, answerHashes: puzzleHashes({ answers, answerHashes: rest.answerHashes }) }));
  return out;
}

class BaseStore {
  constructor(gameId) {
    this.gameId = gameId;
    this.listeners = new Set();
    this.snapshot = { game: null, teams: [], events: [] };
    this.status = 'ok';
  }
  getSnapshot() { return this.snapshot; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this.snapshot); } catch (e) { console.error(e); } } }
  now() { return Date.now(); }
}

// =================================================================== LocalStore

export class LocalStore extends BaseStore {
  constructor(gameId, storage = globalThis.localStorage) {
    super(gameId);
    this.mode = 'local';
    this.label = 'Tryb lokalny (ta przeglądarka, bez Supabase)';
    this.storage = storage;
    this.key = `gielda:${gameId}`;
  }

  async init() {
    this.reload();
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.key);
      this.channel.onmessage = () => { this.reload(); this.emit(); };
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => { if (e.key === this.key) { this.reload(); this.emit(); } });
    }
    return this;
  }

  close() { this.channel?.close(); this.channel = null; }

  read() {
    try {
      const raw = this.storage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  reload() {
    const db = this.read();
    if (!db) { this.snapshot = { game: null, teams: [], events: [] }; return; }
    this.snapshot = {
      game: { ...db.game },
      teams: db.teams.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt })),
      events: db.events.map((e) => ({ ...e })),
    };
  }
  /** Transakcja read-modify-write na localStorage. */
  mutate(fn) {
    const db = this.read();
    if (!db) throw new StoreError('Gra nie istnieje — utwórz ją w panelu prowadzącego.');
    const result = fn(db);
    db.game.rev = (db.game.rev || 0) + 1;
    this.storage.setItem(this.key, JSON.stringify(db));
    this.reload();
    this.channel?.postMessage('changed');
    this.emit();
    return result;
  }
  hashSecret(s, salt) { return sha256Hex(`${salt}:${s}`); }
  assertHost(db, pin) {
    if (!pin || this.hashSecret(pin, db.secrets.salt) !== db.secrets.pinHash) throw new StoreError('Nieprawidłowy PIN prowadzącego.');
  }
  assertTeam(db, teamId, code) {
    const t = db.teams.find((x) => x.id === teamId);
    if (!t || !code || this.hashSecret(code, t.id) !== t.codeHash) throw new StoreError('Nieprawidłowy zespół lub kod.');
    return t;
  }
  addEvent(db, ev) {
    db.seq = (db.seq || 0) + 1;
    const e = { id: db.seq, type: ev.type, teamId: ev.teamId ?? null, turn: ev.turn ?? null, at: Date.now(), payload: ev.payload };
    db.events.push(e);
    return e;
  }

  async hostSetup(pin, totalTurns = 6) {
    if (!pin || String(pin).length < 4) throw new StoreError('PIN musi mieć co najmniej 4 znaki.');
    if (this.read()) throw new StoreError('Gra już istnieje. Użyj PIN-u albo wyczyść dane przeglądarki.');
    const salt = randomId();
    const db = {
      game: { id: this.gameId, phase: 'lobby', turn: 0, totalTurns, turnStartedAt: null, turnDuration: null, rankingVisible: false, testMode: false, rev: 0 },
      secrets: { salt, pinHash: this.hashSecret(pin, salt), puzzles: {} },
      teams: [],
      events: [],
      seq: 0,
    };
    this.storage.setItem(this.key, JSON.stringify(db));
    this.reload();
    this.channel?.postMessage('changed');
    this.emit();
  }
  /** Całkowite usunięcie gry z tej przeglądarki (tylko tryb lokalny). */
  async destroy(pin) {
    const db = this.read();
    if (db) this.assertHost(db, pin);
    this.storage.removeItem(this.key);
    this.reload();
    this.channel?.postMessage('changed');
    this.emit();
  }
  async hostCheck(pin) {
    const db = this.read();
    if (!db) throw new StoreError('Gra nie istnieje.');
    this.assertHost(db, pin);
    return true;
  }
  async hostSyncScenario(pin, scenario) {
    this.mutate((db) => {
      this.assertHost(db, pin);
      db.game.totalTurns = scenario.config.turns;
      db.secrets.puzzles = scenarioPuzzleHashes(scenario);
    });
  }
  async hostReset(pin, { keepTeams = true, testMode = false } = {}) {
    this.mutate((db) => {
      this.assertHost(db, pin);
      db.events = [];
      if (!keepTeams) db.teams = [];
      Object.assign(db.game, { phase: 'lobby', turn: 0, turnStartedAt: null, turnDuration: null, rankingVisible: false, testMode: !!testMode });
    });
  }
  async hostCreateTeam(pin, name) {
    const n = String(name ?? '').trim();
    return this.mutate((db) => {
      this.assertHost(db, pin);
      if (n.length < 1 || n.length > 40) throw new StoreError('Nazwa zespołu: 1–40 znaków.');
      if (db.teams.some((t) => t.name.toLowerCase() === n.toLowerCase())) throw new StoreError('Zespół o tej nazwie już istnieje.');
      const id = randomId();
      const code = randomCode();
      db.teams.push({ id, name: n, codeHash: this.hashSecret(code, id), createdAt: Date.now() });
      return { id, name: n, code };
    });
  }
  async hostRegenCode(pin, teamId) {
    return this.mutate((db) => {
      this.assertHost(db, pin);
      const t = db.teams.find((x) => x.id === teamId);
      if (!t) throw new StoreError('Nie ma takiego zespołu.');
      const code = randomCode();
      t.codeHash = this.hashSecret(code, t.id);
      return code;
    });
  }
  async hostDeleteTeam(pin, teamId) {
    this.mutate((db) => {
      this.assertHost(db, pin);
      db.teams = db.teams.filter((t) => t.id !== teamId);
      db.events = db.events.filter((e) => e.teamId !== teamId);
    });
  }
  async hostStartTurn(pin, duration) {
    return this.mutate((db) => {
      this.assertHost(db, pin);
      const g = db.game;
      let turn;
      if (g.phase === 'lobby') turn = 1;
      else if (g.phase === 'closed') turn = g.turn + 1;
      else throw new StoreError(`Nie można teraz rozpocząć tury (faza: ${g.phase}).`);
      if (turn > g.totalTurns) throw new StoreError('Wszystkie tury zostały rozegrane.');
      if (!Number.isInteger(duration) || duration < 5 || duration > 7200) throw new StoreError('Nieprawidłowa długość tury.');
      const ev = this.addEvent(db, { type: 'turn', turn, payload: { action: 'start', turn, duration } });
      Object.assign(g, { phase: 'open', turn, turnStartedAt: ev.at, turnDuration: duration });
      return turn;
    });
  }
  async hostCloseTurn(pin) {
    return this.mutate((db) => {
      this.assertHost(db, pin);
      const g = db.game;
      if (g.phase !== 'open') throw new StoreError('Nie ma otwartej tury.');
      this.addEvent(db, { type: 'turn', turn: g.turn, payload: { action: 'close', turn: g.turn } });
      g.phase = g.turn >= g.totalTurns ? 'finished' : 'closed';
      g.turnStartedAt = null;
      return g.phase;
    });
  }
  async hostSetFlags(pin, { rankingVisible, testMode } = {}) {
    this.mutate((db) => {
      this.assertHost(db, pin);
      if (rankingVisible != null) db.game.rankingVisible = !!rankingVisible;
      if (testMode != null) db.game.testMode = !!testMode;
    });
  }
  async hostAdjust(pin, teamId, amount, note) {
    return this.mutate((db) => {
      this.assertHost(db, pin);
      if (!Number.isSafeInteger(amount) || amount === 0) throw new StoreError('Nieprawidłowa kwota korekty.');
      if (!db.teams.some((t) => t.id === teamId)) throw new StoreError('Nie ma takiego zespołu.');
      return this.addEvent(db, { type: 'adjustment', teamId, turn: db.game.turn, payload: { amount, note: String(note ?? '').slice(0, 200) } }).id;
    });
  }

  async teamLogin(name, code) {
    const db = this.read();
    if (!db) throw new StoreError('Gra jeszcze nie istnieje.');
    if (!CODE_RE.test(String(code ?? ''))) throw new StoreError('Kod to 6 cyfr.');
    const t = db.teams.find((x) => x.name.trim().toLowerCase() === String(name ?? '').trim().toLowerCase());
    if (!t || this.hashSecret(code, t.id) !== t.codeHash) throw new StoreError('Zła nazwa zespołu lub kod.');
    return { id: t.id, name: t.name };
  }
  async teamTrade(teamId, code, { asset, side, qty }) {
    return this.mutate((db) => {
      this.assertTeam(db, teamId, code);
      const g = db.game;
      if (g.phase !== 'open') throw new StoreError('Handel jest teraz zamknięty.');
      if (Date.now() > g.turnStartedAt + g.turnDuration * 1000 + GRACE_MS) throw new StoreError('Czas tury minął.');
      if (!ID_RE.test(String(asset))) throw new StoreError('Nieznane aktywo.');
      if (side !== 'buy' && side !== 'sell') throw new StoreError('Nieznany rodzaj transakcji.');
      if (!Number.isSafeInteger(qty) || qty <= 0) throw new StoreError('Nieprawidłowa ilość.');
      return this.addEvent(db, { type: 'trade', teamId, turn: g.turn, payload: { asset, side, qty } }).id;
    });
  }
  async teamPuzzle(teamId, code, puzzleId, normalizedAnswer) {
    let outcome = 'wrong';
    const db0 = this.read();
    if (!db0) throw new StoreError('Gra nie istnieje.');
    this.assertTeam(db0, teamId, code);
    if (db0.game.phase === 'finished') throw new StoreError('Gra zakończona.');
    const hashes = db0.secrets.puzzles?.[puzzleId];
    if (!hashes) throw new StoreError('Nieznana zagadka (prowadzący musi zsynchronizować scenariusz).');
    if (db0.events.some((e) => e.type === 'puzzle' && e.teamId === teamId && e.payload.puzzle === puzzleId)) return 'already';
    if (!normalizedAnswer || !hashes.includes(sha256Hex(normalizedAnswer))) return 'wrong';
    this.mutate((db) => {
      this.addEvent(db, { type: 'puzzle', teamId, turn: db.game.turn, payload: { puzzle: puzzleId } });
      outcome = 'ok';
    });
    return outcome;
  }
}

// =================================================================== SupabaseStore

const SUPABASE_CDN = 'https://esm.sh/@supabase/supabase-js@2';
const PAGE = 1000;

export class SupabaseStore extends BaseStore {
  constructor(gameId, url, key) {
    super(gameId);
    this.mode = 'supabase';
    this.label = 'Supabase (synchronizacja online)';
    this.url = url;
    this.key = key;
    this.offset = 0;
    this.eventsById = new Map();
    this.lastId = 0;
  }

  async init() {
    const { createClient } = await import(SUPABASE_CDN);
    this.sb = createClient(this.url, this.key, { auth: { persistSession: false, autoRefreshToken: false } });
    await this.syncClock();
    await this.fullReload();
    this.subscribeRealtime();
    // zabezpieczenie na wypadek zgubionych komunikatów realtime / uśpionego telefonu
    this.timer = setInterval(() => this.incremental().catch(() => {}), 15000);
    this.fullTimer = setInterval(() => this.fullReload().catch(() => {}), 120000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { this.syncClock().catch(() => {}); this.fullReload().catch(() => {}); }
      });
    }
    return this;
  }

  async syncClock() {
    const t0 = Date.now();
    const { data, error } = await this.sb.rpc('server_time');
    const t1 = Date.now();
    if (!error && data) this.offset = new Date(data).getTime() - (t0 + t1) / 2;
  }
  now() { return Date.now() + this.offset; }

  setStatus(s) { if (this.status !== s) { this.status = s; this.emit(); } }

  normGame(r) {
    if (!r) return null;
    return {
      id: r.id, phase: r.phase, turn: r.turn, totalTurns: r.total_turns,
      turnStartedAt: r.turn_started_at ? new Date(r.turn_started_at).getTime() : null,
      turnDuration: r.turn_duration, rankingVisible: r.ranking_visible, testMode: r.test_mode, rev: Number(r.rev),
    };
  }
  normEvent(r) {
    return { id: Number(r.id), type: r.type, teamId: r.team_id, turn: r.turn, at: new Date(r.created_at).getTime(), payload: r.payload || {} };
  }
  publish() {
    const events = [...this.eventsById.values()].sort((a, b) => a.id - b.id);
    this.snapshot = { game: this.game, teams: this.teams || [], events };
    this.emit();
  }

  async fetchGame() {
    const { data, error } = await this.sb.from('games').select('*').eq('id', this.gameId).maybeSingle();
    if (error) throw new StoreError(`Błąd odczytu gry: ${error.message}`);
    this.game = this.normGame(data);
  }
  async fetchTeams() {
    const { data, error } = await this.sb.from('teams').select('id,name,created_at').eq('game_id', this.gameId).order('created_at');
    if (error) throw new StoreError(`Błąd odczytu zespołów: ${error.message}`);
    this.teams = data.map((t) => ({ id: t.id, name: t.name, createdAt: new Date(t.created_at).getTime() }));
  }
  async fetchEventsAfter(afterId) {
    const out = [];
    let from = afterId;
    for (;;) {
      const { data, error } = await this.sb.from('events').select('*').eq('game_id', this.gameId).gt('id', from).order('id').limit(PAGE);
      if (error) throw new StoreError(`Błąd odczytu zdarzeń: ${error.message}`);
      out.push(...data.map((r) => this.normEvent(r)));
      if (data.length < PAGE) break;
      from = Number(data[data.length - 1].id);
    }
    return out;
  }
  async fullReload() {
    try {
      await Promise.all([this.fetchGame(), this.fetchTeams()]);
      const evs = await this.fetchEventsAfter(0);
      this.eventsById = new Map(evs.map((e) => [e.id, e]));
      this.lastId = evs.length ? evs[evs.length - 1].id : 0;
      this.status = 'ok';
      this.publish();
    } catch (e) {
      this.setStatus('offline');
      throw e;
    }
  }
  async incremental() {
    try {
      const prevRev = this.game?.rev;
      await this.fetchGame();
      if (this.game?.rev !== prevRev) await this.fetchTeams();
      const evs = await this.fetchEventsAfter(this.lastId);
      for (const e of evs) { this.eventsById.set(e.id, e); this.lastId = Math.max(this.lastId, e.id); }
      this.status = 'ok';
      this.publish();
    } catch (e) {
      this.setStatus('offline');
      throw e;
    }
  }

  subscribeRealtime() {
    this.channel = this.sb
      .channel(`gielda-${this.gameId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${this.gameId}` }, (msg) => {
        const e = this.normEvent(msg.new);
        this.eventsById.set(e.id, e);
        // luka w numeracji → mogło coś umknąć; dociągnij
        if (e.id > this.lastId + 1) this.incremental().catch(() => {});
        this.lastId = Math.max(this.lastId, e.id);
        this.publish();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${this.gameId}` }, (msg) => {
        const g = this.normGame(msg.new);
        const prev = this.game;
        this.game = g;
        const reset = g && prev && (g.turn < prev.turn || (g.phase === 'lobby' && prev.phase !== 'lobby'));
        if (reset) this.fullReload().catch(() => {});
        else { this.fetchTeams().then(() => this.publish()).catch(() => {}); this.publish(); }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { this.setStatus('ok'); this.incremental().catch(() => {}); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this.setStatus('offline');
      });
  }

  async rpc(fn, args) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new StoreError(error.message || 'Błąd serwera.');
    // natychmiastowe odświeżenie, nie czekając na realtime
    this.incremental().catch(() => {});
    return data;
  }

  async hostSetup() { throw new StoreError('W trybie Supabase grę zakłada się w SQL Editorze: select admin_init_game(...). Zob. docs/SETUP.md.'); }
  async hostCheck(pin) {
    const ok = await this.rpc('host_check', { p_game: this.gameId, p_pin: pin });
    if (ok !== true) throw new StoreError('Nieprawidłowy PIN prowadzącego.');
    return true;
  }
  /** Scenariusz odsłonięty dla bieżącej fazy gry (kursy i newsy przyszłych tur ukryte) albo null, gdy jeszcze nie wgrany. */
  async fetchScenario() {
    const { data, error } = await this.sb.rpc('get_scenario', { p_game: this.gameId });
    if (error) throw new StoreError(`Błąd pobierania scenariusza: ${error.message}`);
    return data ?? null;
  }
  async hostUploadScenario(pin, scenario) {
    return this.rpc('host_upload_scenario', { p_game: this.gameId, p_pin: pin, p_scenario: scenarioForUpload(scenario) });
  }
  // W trybie Supabase scenariusz wgrywa się ręcznie w panelu (hostUploadScenario) — nic nie synchronizujemy automatycznie.
  async hostSyncScenario() {}
  async hostReset(pin, { keepTeams = true, testMode = false } = {}) {
    await this.rpc('host_reset_game', { p_game: this.gameId, p_pin: pin, p_keep_teams: keepTeams, p_test_mode: testMode });
    await this.fullReload();
  }
  async hostCreateTeam(pin, name) {
    const data = await this.rpc('host_create_team', { p_game: this.gameId, p_pin: pin, p_name: name });
    const row = Array.isArray(data) ? data[0] : data;
    await this.fetchTeams(); this.publish();
    return { id: row.id, name: row.name, code: row.code };
  }
  async hostRegenCode(pin, teamId) { return this.rpc('host_regen_code', { p_game: this.gameId, p_pin: pin, p_team: teamId }); }
  async hostDeleteTeam(pin, teamId) {
    await this.rpc('host_delete_team', { p_game: this.gameId, p_pin: pin, p_team: teamId });
    await this.fullReload();
  }
  async hostStartTurn(pin, duration) { return this.rpc('host_start_turn', { p_game: this.gameId, p_pin: pin, p_duration: duration }); }
  async hostCloseTurn(pin) { return this.rpc('host_close_turn', { p_game: this.gameId, p_pin: pin }); }
  async hostSetFlags(pin, { rankingVisible = null, testMode = null } = {}) {
    return this.rpc('host_set_flags', { p_game: this.gameId, p_pin: pin, p_ranking_visible: rankingVisible, p_test_mode: testMode });
  }
  async hostAdjust(pin, teamId, amount, note) {
    return this.rpc('host_adjust', { p_game: this.gameId, p_pin: pin, p_team: teamId, p_amount: amount, p_note: note ?? '' });
  }
  async teamLogin(name, code) {
    const { data, error } = await this.sb.rpc('team_login', { p_game: this.gameId, p_name: name, p_code: code });
    if (error) throw new StoreError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.status === 'locked') throw new StoreError('Zbyt wiele błędnych prób — odczekaj ok. 15 sekund.');
    if (!row || row.status !== 'ok') throw new StoreError('Zła nazwa zespołu lub kod.');
    return { id: row.id, name: row.name };
  }
  async teamTrade(teamId, code, { asset, side, qty }) {
    const id = Number(await this.rpc('team_trade', { p_game: this.gameId, p_team: teamId, p_code: code, p_asset: asset, p_side: side, p_qty: qty }));
    if (id === -2) throw new StoreError('Zbyt wiele błędnych prób kodu — odczekaj ok. 15 sekund.');
    if (id < 0) throw new StoreError('Nieprawidłowy zespół lub kod.');
    return id;
  }
  async teamPuzzle(teamId, code, puzzleId, normalizedAnswer) {
    const r = await this.rpc('team_puzzle', { p_game: this.gameId, p_team: teamId, p_code: code, p_puzzle: puzzleId, p_answer: normalizedAnswer });
    if (r === 'locked') throw new StoreError('Zbyt wiele błędnych prób kodu — odczekaj ok. 15 sekund.');
    if (r === 'denied') throw new StoreError('Nieprawidłowy zespół lub kod.');
    return r;
  }
}

// =================================================================== fabryka

/** Wybór magazynu wg config.js. Parametr URL ?store=local wymusza tryb lokalny. */
export async function createStore(config = CONFIG) {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const gameId = params.get('game') && ID_RE.test(params.get('game')) ? params.get('game') : config.GAME_ID;
  const forceLocal = params.get('store') === 'local';
  const store = isSupabaseConfigured(config) && !forceLocal
    ? new SupabaseStore(gameId, config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY)
    : new LocalStore(gameId);
  await store.init();
  return store;
}
