# Format scenariusza — `data/scenario.json`

Cała treść gry (nazwy, kursy, stopy, newsy, eventy, zagadki, Pewniak, zasady, słowniczek) jest w jednym pliku
`data/scenario.json`. Kod nie zawiera treści gry — **podmiana tego pliku wystarcza**.

Plik jest sprawdzany przy każdym starcie strony (`js/scenario.js` → `validateScenario`) i w testach (`npm test`).
Błąd blokuje grę i pokazuje listę czytelnych komunikatów z dokładną ścieżką, np.
`assets[3] (d01).prices: wymagana lista 7 kursów (tury 1–6 + wycena końcowa)`.
Teksty zawierające `TODO` dają tylko ostrzeżenie (widoczne w panelu prowadzącego).

Szybkie sprawdzenie po edycji:

```bash
node -e "import('./js/scenario.js').then(m=>console.log(m.validateScenario(JSON.parse(require('fs').readFileSync('data/scenario.json','utf8')))))"
```

albo po prostu `npm test` (test „placeholderowy scenariusz jest poprawny” sprawdza aktualny plik).

## Konwencje

- Kwoty i kursy w **złotych**, maks. 2 miejsca po przecinku (w JSON kropka: `12.5`). Wewnętrznie aplikacja liczy w groszach.
- Stopy jako **ułamek na turę**: `-0.015` = −1,5% na kwartał, `0.02` = +2%.
- `id` (aktywów, zagadek): małe litery, cyfry, `_`, `-`, maks. 32 znaki. Id nie zmieniaj w trakcie gry (zdarzenia się do nich odwołują).
- Teksty (`body`, `summary`, …) to zwykły tekst; nowa linia `\n` jest zachowywana. HTML nie jest interpretowany.
- Numeracja tur od 1. `N` = `config.turns`.

## `meta`

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `title` | tekst | tak | Tytuł gry (nagłówki, karta z kodem). |
| `subtitle` | tekst | nie | Podtytuł na ekranie logowania. |
| `version` | tekst | nie | Wersja scenariusza (widoczna w zakładce „?”). |
| `currency` | tekst | nie | Informacyjnie, np. `"zł"`. |

## `config`

| Pole | Typ | Opis |
|---|---|---|
| `turns` | liczba całkowita 1–20 | Liczba tur (kwartałów). Wyznacza długości list niżej. |
| `turnSeconds` | liczba całk. ≥ 10 | Długość tury w sekundach (np. `600` = 10 min). |
| `testTurnSeconds` | liczba całk. ≥ 5 | Długość tury w trybie testowym (np. `30`). |
| `monthsPerTurn` | liczba całk. 1–12 | Ile „miesięcy” tyka w turze; miesiąc = tura / ta liczba. |
| `startCapital` | kwota > 0 | Kapitał startowy zespołu (gotówka). |
| `positionLimit` | ułamek (0, 1] | Maks. udział jednego aktywa w wartości portfela przy zakupie (`0.4` = 40%). |
| `positionLimitExemptTypes` | lista typów | Typy zwolnione z limitu; domyślnie `["cash"]`. Obligacje podlegają limitowi, chyba że dopiszesz `"bond"`. |
| `puzzleReward` | kwota ≥ 0 | Domyślna dotacja za zagadkę (można nadpisać per zagadka). |
| `rankingPlannedTurns` | lista numerów tur | Tylko przypomnienie w panelu, kiedy odsłonić ranking. |

## `assets` — lista aktywów

Wspólne pola:

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `id` | tekst | tak | Unikalny identyfikator. |
| `type` | `cash` \| `bond` \| `index` \| `stock` \| `special` | tak | Rodzaj aktywa (niżej). |
| `name` | tekst | tak | Nazwa wyświetlana. |
| `ticker` | tekst | nie | Skrót (lista rynku, wykres, panel). |
| `description` | tekst | nie | Opis w oknie transakcji. |
| `group` | tekst | nie | Nagłówek grupy na liście rynku (np. „DSH Trop”). Bez niego: grupa wg typu. |
| `buyTurns` | lista tur | nie | W których turach można kupować. Brak = we wszystkich. |
| `sellTurns` | lista tur | nie | W których turach można sprzedawać. Brak = we wszystkich, `[]` = nigdy. |
| `offer` | `{ title, body }` | nie | Baner oferty na rynku, gdy aktywo jest do kupienia w bieżącej turze (np. Pewniak). |

Typy:

- **`cash`** — dokładnie jedno. Pole `rates`: lista **N** stóp; na koniec tury *t* gotówka (tylko dodatnie saldo)
  zmienia się o `rates[t-1]` (inflacja, np. `-0.015`). Gotówką się nie handluje.
- **`bond`** — `rates`: lista **N** stóp; na koniec tury *t* odsetki `rates[t-1]` są dopisywane do wartości obligacji
  (kapitalizacja). Kupno/sprzedaż za kwotę. Zmianę oprocentowania „eventem” zapisujesz po prostu inną stopą w danej turze
  i opisujesz w evencie/newsie.
- **`index`**, **`stock`**, **`special`** — `prices`: lista **N+1** kursów (zł za sztukę):
  `prices[0]` … `prices[N-1]` to kursy obowiązujące w turach 1…N (handel po kursie bieżącej tury),
  `prices[N]` to **wycena końcowa** po ostatniej turze. Po zamknięciu tury *t* portfele wyceniane są kursem `prices[t]`.
  Kurs `0` oznacza aktywo bez wartości (kupno zablokowane).
- **`special`** (np. Fundusz Pewniak) zachowuje się jak akcja; zwykle ma `buyTurns: [3]`, `sellTurns: []`, `offer`
  i kursy kończące się na `0`.

Handel odbywa się w sztukach całkowitych (zakup „za kwotę” kupuje tyle pełnych sztuk, ile się zmieści).

## `turns` — lista dokładnie N tur

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `turn` | liczba | tak | Kolejny numer: 1, 2, … |
| `label` | tekst | tak | Np. „Kwartał 1” / „Q1 2027”. |
| `news` | lista | tak (może być pusta) | Paczka newsów pokazywana od startu tury. |
| `news[].title` | tekst | tak | Tytuł. |
| `news[].body` | tekst | tak | 2–3 zdania. |
| `news[].why` | tekst | nie | Jedno zdanie „z czego wynika”. |
| `news[].asset` | id aktywa | nie | Etykieta newsa = nazwa aktywa. |
| `news[].scope` | `global` \| `biwak` | nie | Etykieta „Ogólne” / „Biwak” (gdy brak `asset`). |
| `summary` | tekst | nie | Podsumowanie tego kwartału — pokazywane **na starcie następnej tury** (ostatnie: po zakończeniu gry). |
| `months` | lista `monthsPerTurn` elementów | tak | Miesiące tury. |
| `months[].name` | tekst | nie | Nazwa miesiąca na zegarze, np. „Październik”. |
| `months[].event` | `null` \| `{ title, body }` | nie | Event miesiąca (np. BIWAK, wybory komendanta) — na projektorze w trakcie tego miesiąca, u graczy od tego miesiąca. Ceny w trakcie tury się nie zmieniają. |

Nie stosuj etykiet typu „kryzys/odbicie” — aplikacja ich nie dodaje, a newsy nie mają pola kategorii.

## `puzzles` — zagadki

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `id` | tekst | tak | Unikalny. |
| `title` | tekst | tak | Np. „Karta 3”. |
| `hint` | tekst | nie | Tekst widoczny w aplikacji (wskazówka / treść karty). |
| `answers` | lista tekstów | jedno z dwóch | Hasła jawnie. |
| `answerHashes` | lista hashy | jedno z dwóch | SHA-256 (hex) **znormalizowanego** hasła — hasło nie jest widoczne w publicznym JSON-ie. |
| `reward` | kwota | nie | Dotacja; domyślnie `config.puzzleReward`. |

Normalizacja haseł: małe litery, bez polskich znaków (ł→l itd.), bez spacji i interpunkcji.
„Bieg o Patent!” ≡ „biegopatent”. Hash generujesz poleceniem:

```bash
node tools/hash-answer.mjs "Bieg o patent"
```

Dotacja trafia do gotówki raz na zespół. Panel prowadzącego po zalogowaniu wysyła hashe haseł na serwer
(`host_sync_scenario`), więc po zmianie zagadek wystarczy ponownie wejść do panelu.

## `rules` i `glossary`

- `rules`: lista `{ title, body }` — sekcje zakładki „?” u gracza (pod nimi aplikacja sama dopisuje liczby z `config`).
- `glossary`: lista `{ term, definition }` — słowniczek.

## Generator placeholdera

`node tools/generate-placeholder-scenario.mjs` odtwarza obecny placeholder (losowe kursy, teksty TODO).
**Nadpisuje** `data/scenario.json` — nie uruchamiaj po wpisaniu prawdziwej treści.

## Uwaga o jawności

Strona jest statyczna, więc `data/scenario.json` (łącznie z przyszłymi kursami) może pobrać każdy, kto zna adres.
Przy publicznym repozytorium wgraj prawdziwy scenariusz jak najpóźniej i używaj `answerHashes` dla haseł.
