# Wdrożenie: Supabase + GitHub Pages

Bez Supabase aplikacja działa w **trybie lokalnym** (jedna przeglądarka, kilka kart) — wystarczy do testów.
Do gry na telefonach potrzebny jest darmowy projekt Supabase i GitHub Pages.

## 1. Projekt Supabase

1. Załóż projekt na <https://supabase.com> (region np. Frankfurt / `eu-central-1`).
2. **SQL Editor → New query** → wklej całą zawartość `supabase/migrations/001_init.sql` → **Run**.
   Migracja tworzy tabele `games`, `game_secrets`, `teams`, `events`, polityki RLS, funkcje RPC i włącza realtime
   dla `games` oraz `events`.
3. **Nowy query** → wklej całą zawartość `supabase/migrations/002_hide_future_and_lockout.sql` → **Run**
   (kursy i newsy przyszłych tur ukryte w bazie, blokada zgadywania kodów, kody 6-cyfrowe; można uruchomić ponownie).
4. W tym samym SQL Editorze zainicjalizuj grę i ustaw PIN prowadzącego (**min. 8 znaków**; zgadywanie PIN-u jest
   blokowane tylko przy logowaniu do panelu, więc PIN ma być długi i losowy):

   ```sql
   select public.admin_init_game('gielda', 'TwójDługiPIN', 6);
   ```

   `gielda` musi być równe `GAME_ID` w `js/config.js`, `6` = liczba tur ze scenariusza.
   Tę samą komendę możesz uruchomić ponownie, żeby zmienić PIN. Funkcja nie jest dostępna z przeglądarki.
5. **Project Settings → API Keys**: skopiuj **Project URL** i klucz **publishable** (`sb_publishable_…`;
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

1. Przygotuj prawdziwy scenariusz (format: `docs/SCENARIO.md`) jako plik **poza repozytorium** albo w `data/private/`
   (jest w `.gitignore`). Sprawdź go: `node tools/check-scenario.mjs ścieżka/do/scenariusza.json`.
   Plik `data/scenario.json` w repo zostaje placeholderem (używa go tylko tryb lokalny i testy).
2. Wejdź do `host.html`, zaloguj PIN-em i **wgraj scenariusz** („Wybierz plik scenariusza”). Panel zwaliduje plik,
   zamieni hasła zagadek na hashe i wyśle go do bazy. Gracze dostają z serwera tylko odsłonięte tury
   (kursy bieżącej i minionych, newsy do bieżącej tury); reszta jest ukryta aż do startu/zamknięcia tury.
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
psql -d gielda_test -f supabase/migrations/002_hide_future_and_lockout.sql
psql -d gielda_test -f supabase/tests/smoke.sql   # kończy się ROLLBACK
```

## Rozwiązywanie problemów

- **„Gra nie jest jeszcze zainicjalizowana”** — nie wykonano `admin_init_game` albo `GAME_ID` się różni.
- **„Czekamy na prowadzącego — scenariusz gry nie został jeszcze wgrany”** (gracze/projektor) — wgraj scenariusz w `host.html`.
- **„Nieznana zagadka (prowadzący musi wgrać scenariusz)”** — j.w.
- **„Zbyt wiele błędnych prób”** — po 10 błędnych kodach zespół jest blokowany na 15 s (PIN w panelu: 8 błędów → 30 s).
- **Nie mogę zmienić PIN-u** — uruchom ponownie `admin_init_game` z nowym PIN-em (zeruje też blokadę).
- **Brak aktualizacji na żywo** — sprawdź, czy tabele `games` i `events` są w publikacji `supabase_realtime`
  (Database → Publications). Aplikacja i tak dociąga zmiany co 15 s i po powrocie do karty.
- **Telefon ma źle ustawiony zegar** — nie szkodzi: zegar tury liczony jest względem czasu serwera.
