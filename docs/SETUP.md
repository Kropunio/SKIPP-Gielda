# Wdrożenie: Supabase + GitHub Pages

Bez Supabase aplikacja działa w **trybie lokalnym** (jedna przeglądarka, kilka kart) — wystarczy do testów.
Do gry na telefonach potrzebny jest darmowy projekt Supabase i GitHub Pages.

## 1. Projekt Supabase

1. Załóż projekt na <https://supabase.com> (region np. Frankfurt / `eu-central-1`).
2. **SQL Editor → New query** → wklej całą zawartość `supabase/migrations/001_init.sql` → **Run**.
   Migracja tworzy tabele `games`, `game_secrets`, `teams`, `events`, polityki RLS, funkcje RPC i włącza realtime
   dla `games` oraz `events`.
3. W tym samym SQL Editorze zainicjalizuj grę i ustaw PIN prowadzącego (min. 4 znaki, lepiej 6+):

   ```sql
   select public.admin_init_game('gielda', 'TwójPIN', 6);
   ```

   `gielda` musi być równe `GAME_ID` w `js/config.js`, `6` = liczba tur ze scenariusza.
   Tę samą komendę możesz uruchomić ponownie, żeby zmienić PIN. Funkcja nie jest dostępna z przeglądarki.
4. **Project Settings → API Keys**: skopiuj **Project URL** i klucz **publishable** (`sb_publishable_…`;
   w starszych projektach „anon public”). **Nigdy** nie wklejaj klucza `secret` / `service_role`.

## 2. `js/config.js`

```js
export const CONFIG = {
  SUPABASE_URL: 'https://twojprojekt.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_...',
  GAME_ID: 'gielda',
  SCENARIO_URL: './data/scenario.json',
};
```

Klucz publishable jest publiczny z założenia — bezpieczeństwo zapewniają RLS i funkcje RPC
(klient może tylko czytać grę i zdarzenia; zapis wyłącznie przez RPC z kodem zespołu albo PIN-em).
Panel prowadzącego pokazuje u góry, który tryb jest aktywny. Parametr `?store=local` w adresie wymusza tryb lokalny.

## 3. GitHub Pages

1. Wypchnij repozytorium na GitHub (gałąź `main`).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch: `main`, folder `/ (root)` → Save.
3. Po chwili strona jest pod `https://<użytkownik>.github.io/skipp-gielda/`:
   - `index.html` — gracze (telefony),
   - `host.html` — panel prowadzącego,
   - `screen.html` — projektor.

Plik `.nojekyll` w repo wyłącza przetwarzanie Jekyllem. Nie ma kroku budowania.

## 4. Przed zbiórką (checklista)

1. Podmień `data/scenario.json` na prawdziwy (format: `docs/SCENARIO.md`), `npm test`, commit, push.
2. Wejdź do `host.html`, zaloguj PIN-em (panel synchronizuje hashe haseł zagadek i liczbę tur).
3. Dodaj zespoły, wydrukuj kody („Drukuj kody”). Kody widać tylko na urządzeniu, na którym je utworzono.
4. Włącz **tryb testowy** (tura 30 s), rozegraj próbną turę z 2 telefonami, sprawdź projektor.
5. **Reset gry** z zaznaczonym „zachowaj zespoły” i wyłączonym trybem testowym.
6. Po grze: „CSV: stan portfeli po turach” i „CSV: wszystkie transakcje” (Excel: separator `;`, przecinek dziesiętny).

## 5. Test migracji lokalnie (opcjonalnie)

Z lokalnym Postgresem 15+ (nie na produkcji):

```bash
createdb gielda_test
psql -d gielda_test -c "create role anon nologin; create role authenticated nologin; create schema extensions; create publication supabase_realtime;"
psql -d gielda_test -f supabase/migrations/001_init.sql
psql -d gielda_test -f supabase/tests/smoke.sql   # kończy się ROLLBACK
```

## Rozwiązywanie problemów

- **„Gra nie jest jeszcze zainicjalizowana”** — nie wykonano `admin_init_game` albo `GAME_ID` się różni.
- **„Nieznana zagadka (prowadzący musi zsynchronizować scenariusz)”** — zaloguj się do panelu prowadzącego.
- **Brak aktualizacji na żywo** — sprawdź, czy tabele `games` i `events` są w publikacji `supabase_realtime`
  (Database → Publications). Aplikacja i tak dociąga zmiany co 15 s i po powrocie do karty.
- **Telefon ma źle ustawiony zegar** — nie szkodzi: zegar tury liczony jest względem czasu serwera.
