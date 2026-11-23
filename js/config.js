// Konfiguracja wdrożenia. Gdy SUPABASE_URL lub SUPABASE_PUBLISHABLE_KEY są puste,
// aplikacja działa w trybie lokalnym (LocalStore: localStorage + BroadcastChannel, jedna przeglądarka).
// Instrukcja podpięcia Supabase: docs/SETUP.md.

export const CONFIG = {
  // np. 'https://abcdefghijklmnop.supabase.co'
  SUPABASE_URL: 'https://uxmrjbbyrpnikllbebrr.supabase.co',
  // klucz publiczny „publishable” (sb_publishable_...) lub starszy „anon” — NIGDY service_role / secret
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ff96DhjVlrA50x0Yg5Y1CQ_FWIj6K86',
  // identyfikator gry w tabeli games (ten sam co w admin_init_game)
  GAME_ID: 'gielda',
  // plik scenariusza (treść gry)
  SCENARIO_URL: './data/scenario.json',
};

export const isSupabaseConfigured = (c = CONFIG) => Boolean(c.SUPABASE_URL && c.SUPABASE_PUBLISHABLE_KEY);
