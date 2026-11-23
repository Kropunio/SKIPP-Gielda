// Wspólny start stron: scenariusz, magazyn, przeliczanie stanu po każdej zmianie.
//  - tryb lokalny   : scenariusz z pliku data/scenario.json (cały, bez ukrywania — to tylko test/offline),
//  - tryb Supabase  : scenariusz z serwera (get_scenario) — kursy, stopy i newsy przyszłych tur są null/puste,
//                     odsłaniają się wraz z postępem gry. Plik w repo nie jest używany.
import { CONFIG } from './config.js';
import { loadScenario, validateScenario } from './scenario.js';
import { createStore } from './store.js';
import { replay } from './engine.js';
import { escapeHtml } from './format.js';

/**
 * boot({ onUpdate(ctx), allowNoScenario }) → ctx = { scenario, warnings, store, snapshot, state, game }.
 * onUpdate wołane po każdej zmianie danych (realtime / inna karta / własna akcja).
 * allowNoScenario (panel prowadzącego): gdy w bazie nie ma jeszcze scenariusza, ctx.scenario = null zamiast czekania.
 */
export async function boot({ onUpdate, allowNoScenario = false }) {
  let store;
  try {
    store = await createStore(CONFIG);
  } catch (e) {
    fatal('Nie można połączyć się z magazynem danych', [e.message]);
    throw e;
  }
  const remote = store.mode === 'supabase';
  const ctx = { scenario: null, warnings: [], store, snapshot: null, state: null, game: null, reveal: null };

  const setRemoteScenario = (raw) => {
    if (!raw) { ctx.scenario = null; ctx.reveal = null; return; }
    const { _reveal, ...scenario } = raw;
    const v = validateScenario(scenario, { partial: true });
    if (!v.ok) throw Object.assign(new Error('Błędny scenariusz z serwera'), { errors: v.errors });
    ctx.scenario = scenario;
    ctx.reveal = _reveal;
  };

  try {
    if (remote) {
      setRemoteScenario(await store.fetchScenario());
      while (!ctx.scenario && !allowNoScenario) {
        showWaiting('Czekamy na prowadzącego — scenariusz gry nie został jeszcze wgrany. Strona odświeży się sama.');
        await new Promise((r) => setTimeout(r, 4000));
        setRemoteScenario(await store.fetchScenario().catch(() => null));
      }
      if (ctx.scenario) document.getElementById('waiting')?.remove();
    } else {
      ({ scenario: ctx.scenario, warnings: ctx.warnings } = await loadScenario(CONFIG.SCENARIO_URL));
    }
  } catch (e) {
    fatal('Nie można wczytać scenariusza gry', e.errors || [e.message]);
    throw e;
  }

  // ---- odświeżanie scenariusza z serwera
  let fetching = null;
  let monthTimer = null;
  let backoffUntil = 0;
  let lastFetchAt = 0;
  const refreshScenario = () => {
    if (!remote) return Promise.resolve();
    if (!fetching) {
      fetching = store.fetchScenario()
        .then((raw) => { setRemoteScenario(raw); backoffUntil = 0; lastFetchAt = Date.now(); })
        .catch((e) => { console.error(e); backoffUntil = Date.now() + 3000; setTimeout(recompute, 3100); })
        .finally(() => { fetching = null; scheduleMonthRefetch(store.getSnapshot().game); recompute(); });
    }
    return fetching;
  };
  // Scenariusz starszy od stanu gry (rev) → najpierw pobierz nowy, potem przelicz (inaczej kursy mogłyby być null).
  const isStale = (game) => remote && game && ctx.scenario && Number(ctx.reveal.rev) < Number(game.rev);
  let probedRev = -1;
  const scheduleMonthRefetch = (game) => {
    clearTimeout(monthTimer);
    if (!remote || !ctx.scenario || !game || game.phase !== 'open' || !game.turnStartedAt) return;
    const mpt = ctx.scenario.config.monthsPerTurn;
    const monthMs = (game.turnDuration * 1000) / mpt;
    const elapsed = store.now() - game.turnStartedAt;
    const month = Math.min(mpt, Math.floor(elapsed / monthMs) + 1);
    if (month >= mpt) return;
    monthTimer = setTimeout(() => refreshScenario(), Math.max(500, month * monthMs - elapsed + 400));
  };

  let lastKey = '';
  function recompute() {
    const snap = store.getSnapshot();
    if (isStale(snap.game)) { if (Date.now() >= backoffUntil) refreshScenario(); return; }
    ctx.snapshot = snap;
    ctx.game = snap.game;
    if (!ctx.scenario) {
      ctx.state = null;
      // panel prowadzącego bez scenariusza: sprawdź ponownie, gdy zmieni się stan gry (np. wgranie z innej karty)
      if (remote && snap.game && Number(snap.game.rev) !== probedRev && Date.now() >= backoffUntil) { probedRev = Number(snap.game.rev); refreshScenario(); }
      onUpdate(ctx);
      return;
    }
    const state = replay(ctx.scenario, snap.teams, snap.events);
    // Zdarzenia (np. zamknięcie tury) mogą dotrzeć przed zmianą wiersza gry/scenariusza: brakujący kurs = pobierz scenariusz jeszcze raz.
    if (remote && ctx.scenario.assets.some((a) => a.prices && a.prices[state.priceIndex] == null)) {
      if (Date.now() - lastFetchAt > 1000) refreshScenario(); else setTimeout(recompute, 1000);
      return;
    }
    ctx.state = state;
    const key = snap.game ? `${snap.game.phase}|${snap.game.turn}` : '';
    if (remote && key !== lastKey) { lastKey = key; scheduleMonthRefetch(snap.game); }
    onUpdate(ctx);
  }
  store.subscribe(recompute);
  recompute();
  if (ctx.scenario?.meta?.title) document.title = `${ctx.scenario.meta.title} — ${document.title}`;
  ctx.refreshScenario = refreshScenario;
  return ctx;
}

function showWaiting(msg) {
  let el = document.getElementById('waiting');
  if (!el) {
    el = document.createElement('main');
    el.id = 'waiting';
    el.className = 'fatal';
    document.body.appendChild(el);
  }
  el.innerHTML = `<h1>Giełda Hufca</h1><p>${escapeHtml(msg)}</p>`;
}

export function fatal(title, lines) {
  document.body.innerHTML = `<main class="fatal"><h1>${escapeHtml(title)}</h1><ul>${lines
    .map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul><p class="muted">Szczegóły formatu: docs/SCENARIO.md i docs/SETUP.md.</p></main>`;
}
