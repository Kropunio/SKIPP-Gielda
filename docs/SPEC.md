# Giełda Hufca — specyfikacja aplikacji (plan A)

Zbiórka SKIPP 30.11.2026 (pon), 20:00–22:00, Sala Konferencyjna DS1. Prowadzący: Jędrzej.

**Zasada nadrzędna:** plan B (projektor + papier + Excel prowadzącego) jest pełnoprawną grą i nie zależy od aplikacji. Aplikacja to dodatek.

**Etap 1 (teraz):** cała architektura i wszystkie ekrany. Treść gry (aktywa, kursy, newsy, eventy, zagadki, Pewniak) to dane w `data/scenario.json` z placeholderami, podmieniane później bez zmian w kodzie.

## 1. Przebieg gry
- 6 tur × 10 min (liczba tur i długość z configu). Jedna tura = jeden kwartał.
- W turze tyka zegar 3 miesięcy (długość tury / 3). Miesiące to zegar + opcjonalne eventy przypisane do miesiąca (np. BIWAK, wybory komendanta). Ceny NIE zmieniają się w trakcie tury.
- Kolejność: start tury → podsumowanie poprzedniego kwartału + paczka newsów bieżącego kwartału → handel po bieżących cenach → koniec tury: blokada, prowadzący zatwierdza → nowe ceny, inflacja/odsetki.
- Ranking widoczny tylko gdy prowadzący go odsłoni (planowo w turach 3 i 5 + koniec).
- Tury przełącza tylko prowadzący.

## 2. Aktywa (typy — konkretne wartości w scenariuszu)
- `cash` — Śledzie do namiotu: stopa na turę (np. -1,5%).
- `bond` — Obligacje Komendy: stopa na turę, może się zmieniać eventem.
- `index` — Indeks CHORĄGIEW (ETF): kurs na turę ze scenariusza.
- `stock` — drużyny (18 DSH Trop + 5 fikcyjnych): kurs na turę ze scenariusza.
- `special` — Fundusz Pewniak: dostępny tylko w wybranej turze, potem wartość wg scenariusza (np. 0).

## 3. Newsy
- Paczka na turę: lista newsów, każdy: `title`, `body` (2–3 zdania), `why` (1 zdanie „z czego wynika”), opcjonalnie `asset` lub `global`/`biwak`.
- Podsumowanie kwartału (`summary`) pokazywane na starcie kolejnej tury.
- Bez etykiet typu kryzys/odbicie.

## 4. Zagadki
- N kart (scenariusz), +X zł każda, raz na zespół. Hasło wpisywane w aplikacji, normalizacja (wielkość liter, polskie znaki, spacje). Zespół działa razem — żadnego podziału ról w UI ani tekstach.

## 5. Funkcje
- **Gracz** (telefon): logowanie nazwa zespołu + 4-cyfrowy kod (wiele telefonów na zespół), portfel, kupno/sprzedaż po cenie bieżącej tury, newsy, zagadki, zakładka „?” (zasady, słowniczek z danych).
- **„Skąd się wzięło moje saldo”**: od kapitału startowego: inflacja na gotówce, odsetki z obligacji, zysk/strata na każdym aktywie, dotacje za zagadki, korekty prowadzącego.
- **Panel prowadzącego** (PIN): tworzenie gry i zespołów (kody), start/koniec tury, odsłanianie rankingu, dotacje/potrącenia, podgląd portfeli, reset, eksport CSV (stan + transakcje, do Excela planu B), tryb testowy (tura 30 s).
- **Projektor**: tura, zegar tury i miesiąca, event miesiąca, newsy, kursy, ranking gdy odsłonięty.
- Dziennik transakcji.
- Kapitał startowy i limit pozycji (np. 40%, nie dotyczy gotówki) z configu.
- Bez danych osobowych.

## 6. Stack
GitHub Pages (statyczne pliki) + Supabase (synchronizacja). Tryb lokalny (bez Supabase) do developmentu/testów.
