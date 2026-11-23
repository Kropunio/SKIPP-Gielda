// Wspólny start stron: wczytanie i walidacja scenariusza, magazyn, przeliczanie stanu po każdej zmianie.
import { CONFIG } from './config.js';
import { loadScenario } from './scenario.js';
import { createStore } from './store.js';
import { replay } from './engine.js';
import { escapeHtml } from './format.js';

/**
 * boot({ onUpdate(ctx) }) → ctx = { scenario, warnings, store, snapshot, state, game }.
 * onUpdate wołane po każdej zmianie danych (realtime / inna karta / własna akcja).
 */
export async function boot({ onUpdate }) {
  let scenario, warnings;
  try {
    ({ scenario, warnings } = await loadScenario(CONFIG.SCENARIO_URL));
  } catch (e) {
    fatal('Nie można wczytać scenariusza gry', e.errors || [e.message]);
    throw e;
  }
  let store;
  try {
    store = await createStore(CONFIG);
  } catch (e) {
    fatal('Nie można połączyć się z magazynem danych', [e.message]);
    throw e;
  }
  const ctx = { scenario, warnings, store, snapshot: null, state: null, game: null };
  const recompute = () => {
    ctx.snapshot = store.getSnapshot();
    ctx.game = ctx.snapshot.game;
    ctx.state = replay(scenario, ctx.snapshot.teams, ctx.snapshot.events);
    onUpdate(ctx);
  };
  store.subscribe(recompute);
  recompute();
  if (scenario.meta?.title) document.title = `${scenario.meta.title} — ${document.title}`;
  return ctx;
}

export function fatal(title, lines) {
  document.body.innerHTML = `<main class="fatal"><h1>${escapeHtml(title)}</h1><ul>${lines
    .map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul><p class="muted">Szczegóły formatu: docs/SCENARIO.md i docs/SETUP.md.</p></main>`;
}
