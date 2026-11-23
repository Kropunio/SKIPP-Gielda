# Giełda Hufca

Edukacyjna gra o inwestowaniu na zbiórkę harcerską: 3–5 zespołów gra na telefonach, prowadzący steruje turami
z panelu, a projektor pokazuje zegar, newsy, kursy i (gdy prowadzący zechce) ranking.
Jedna tura = jeden kwartał; w turze tyka zegar trzech miesięcy z opcjonalnymi eventami.
Aplikacja jest dodatkiem — gra działa też na papierze (eksport CSV do Excela prowadzącego).

Statyczna strona (HTML + CSS + ES modules, bez kroku budowania) na GitHub Pages; synchronizacja przez Supabase
albo — do testów — tryb lokalny w jednej przeglądarce.

## Ekrany

| Plik | Dla kogo | Co robi |
|---|---|---|
| `index.html` | gracze (telefon) | logowanie nazwą zespołu + 4-cyfrowym kodem (wiele telefonów na zespół), portfel, rynek (kup/sprzedaj za kwotę lub ilość), newsy i podsumowanie kwartału, zagadki, dziennik, „?” (zasady, słowniczek), „Skąd się wzięło moje saldo” |
| `host.html` | prowadzący (PIN) | tworzenie gry, zespoły i kody do druku, start/koniec tury, odsłanianie rankingu, dotacje/potrącenia, podgląd portfeli, eksport CSV, reset, tryb testowy (tura 30 s) |
| `screen.html` | projektor 16:9 | tura/kwartał, zegar tury i miesiąca, event miesiąca, rotujące newsy, kursy ze zmianą, wykres (SVG), ranking gdy odsłonięty |

## Struktura

```
index.html, host.html, screen.html
css/style.css, css/screen.css
data/scenario.json          ← CAŁA treść gry (placeholdery TODO) — format: docs/SCENARIO.md
js/config.js                ← adres i klucz Supabase (puste = tryb lokalny), GAME_ID
js/engine.js                ← czysta logika gry (bez I/O): ceny, wycena, walidacja, rozliczenie tur,
                              replay zdarzeń, rozpiska salda, ranking, zegar, hasła
js/scenario.js              ← walidator i loader scenariusza
js/store.js                 ← LocalStore (localStorage + BroadcastChannel) i SupabaseStore (RPC + realtime)
js/app.js, js/ui.js         ← wspólny start stron, elementy UI, wykres SVG
js/player.js, js/host.js, js/screen.js
js/export.js, js/format.js, js/sha256.js
supabase/migrations/001_init.sql   ← schemat, RLS, funkcje RPC (nie jest nigdzie stosowany automatycznie)
supabase/tests/smoke.sql           ← test dymny migracji na lokalnym Postgresie
tests/engine.test.js, tests/store.test.js   ← `node --test`
tests/e2e/local.e2e.mjs            ← test w przeglądarce (Playwright), opcjonalny
tools/hash-answer.mjs, tools/generate-placeholder-scenario.mjs
docs/SPEC.md, docs/SCENARIO.md, docs/SETUP.md
```

### Jak to działa

Stan gry nie jest nigdzie zapisywany wprost — jest **odtwarzany deterministycznie** (`replay`) ze scenariusza
i listy zdarzeń: `turn` (start/koniec tury), `trade`, `puzzle`, `adjustment`. Każde urządzenie liczy to samo.
Serwer (RPC) sprawdza kod zespołu / PIN, fazę gry i czas tury; saldo i limit pozycji sprawdza silnik przy odtwarzaniu
— transakcja, która się nie mieści (np. dwa telefony wydały tę samą gotówkę), zostaje w dzienniku jako „odrzucona”.
Kwoty liczone są w groszach (liczby całkowite), więc rozpiska salda zgadza się z wartością portfela co do grosza.

Koniec tury (tylko prowadzący): blokada handlu → inflacja na gotówce, odsetki od obligacji → wycena po nowych kursach.
Po upływie czasu handel blokuje się sam (w przeglądarce i w RPC), ale turę zamyka prowadzący.

## Uruchomienie lokalne

Wymagany dowolny serwer HTTP (moduły ES nie działają z `file://`):

```bash
python3 -m http.server 8000
```

- <http://localhost:8000/host.html> — utwórz grę (PIN), dodaj zespoły, wystartuj turę,
- <http://localhost:8000/index.html> — gracz (w kolejnej karcie; ta sama przeglądarka = ta sama gra),
- <http://localhost:8000/screen.html> — projektor.

W trybie lokalnym wszystko żyje w `localStorage` tej przeglądarki, a karty synchronizują się przez
`BroadcastChannel`. Karty gracza dzielą jedną sesję logowania — żeby zagrać innym zespołem, wyloguj się
(zakładka Portfel). Do gry na wielu telefonach potrzebne jest Supabase (`docs/SETUP.md`).

## Testy

```bash
npm test            # = node --test (bez zależności): silnik, walidator, CSV, LocalStore, symulacja pełnej gry
# opcjonalnie, z Playwright i serwerem na porcie 8123:
python3 -m http.server 8123 & node tests/e2e/local.e2e.mjs
```

## Podmiana scenariusza

1. Edytuj `data/scenario.json` według `docs/SCENARIO.md` (aktywa, kursy na każdą turę + wycena końcowa, stopy,
   newsy, podsumowania, eventy miesięcy, zagadki, oferta Pewniak, zasady, słowniczek).
2. `npm test` — walidator wypisze dokładne błędy. To samo sprawdzenie dzieje się przy starcie każdej strony.
3. Commit + push. Po wejściu do panelu prowadzącego hashe haseł zagadek trafią na serwer.

Hasła zagadek można zapisać jako hash: `node tools/hash-answer.mjs "hasło"`.

## Wdrożenie

Supabase + GitHub Pages: `docs/SETUP.md`.

## Prywatność

Aplikacja nie zbiera danych osobowych: zespoły mają tylko nazwę i kod, brak kont i analityki.
