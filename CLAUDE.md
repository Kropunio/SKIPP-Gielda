# CLAUDE.md — Giełda Hufca (kontekst do kontynuacji pracy)

Ten plik zbiera cały kontekst projektu. Przeczytaj go w całości przed pracą. Szczegóły: `docs/SPEC.md` (funkcje), `docs/SCENARIO.md` (format danych gry), `docs/SETUP.md` (wdrożenie), `README.md` (struktura i uruchomienie).

Stan na: 23.11.2026, 23:30.

## 1. Co to jest i po co

- Gra edukacyjna o inwestowaniu „Giełda Hufca” na zbiórkę SKIPP (akademicy ZHP, dorośli studenci).
- Termin: **poniedziałek 30.11.2026, 20:00–22:00**, Sala Konferencyjna DS1 (Poznań). Zagadki rozłożone na terenie kampusu przy budynku.
- Prowadzący i właściciel repozytorium: Jędrzej (GitHub `Kropunio`). Pisze po polsku, krótko i bezpośrednio. Woli konkretne propozycje niż otwarte pytania i szczerą ocenę zamiast przytakiwania.
- Uczestnicy: ok. 9–20 osób w 3–5 zespołach po 3–4 osoby. Każdy zespół gra na co najmniej 1 telefonie, a projektor pokazuje stan gry wszystkim.
- Cel wychowawczy: świadome decyzje finansowe. Gracze poznają inflację, procent składany, obligacje, akcje, ETF i dywersyfikację oraz uczą się rozpoznawać piramidy finansowe. Kapitał jest wirtualny. Nie ma dźwigni, krypto ani krótkiej sprzedaży. W debriefie pada jasna informacja, że to edukacja, a nie porada inwestycyjna, i że zyski w grze są przyspieszone (18 miesięcy w godzinę), a prawdziwy ETF daje kilka procent rocznie.

## 2. Zasada nadrzędna: plan A i plan B

- **Plan B jest pełnoprawną grą i w 100% nie zależy od aplikacji.** Składa się z:
  - prezentacji offline (PPTX) na projektorze,
  - wydruków,
  - kart zleceń: zespół wypisuje u siebie aktywo i kwotę, a prowadzący przepisuje to do Excela,
  - Excela z formułami na laptopie prowadzącego, który liczy portfele i ranking,
  - newsów w PDF wrzucanych na grupę,
  - ściąg A6 (po 1 na osobę + 5 zapasowych).
- **Aplikacja (to repozytorium) to plan A, czyli dodatek.** Decyzja go/no-go zapada **26.11 wieczorem**. Jeśli aplikacja nie będzie gotowa i przetestowana do 28.11, gramy na planie B.
- Eksport CSV z panelu ma pasować do Excela planu B, żeby w każdej chwili dało się przejść na papier bez utraty stanu.
- Materiały planu B (Excel, karta zleceń, PPTX, ściągi, PDF newsów) i konspekt powstają w osobnej rozmowie na claude.ai, poza tym repozytorium.

## 3. Ustalone zasady gry (decyzje — nie zmieniaj bez pytania)

**Tury**
- **6 tur × 10 minut.** Jedna tura to jeden **kwartał**, więc cała gra to 1,5 roku.
- W turze tyka zegar 3 miesięcy, co ok. 3 min 20 s. Miesiące to tylko zegar i ewentualne duże eventy (np. BIWAK, wybory komendanta chorągwi).
- **Ceny zmieniają się wyłącznie na końcu tury.** Kolejność w turze:
  1. Na starcie: podsumowanie poprzedniego kwartału (co się stało, zmiany cen) i paczka newsów o bieżącym kwartale. Newsy opisują sytuację i przyczyny, ale nie wynik.
  2. Zespoły handlują po bieżących cenach.
  3. Koniec tury: blokada handlu. Prowadzący zatwierdza, potem wchodzą nowe ceny oraz inflacja i odsetki.
- Turę przełącza tylko prowadzący.
- Ranking jest ukryty. Prowadzący odsłania go na projektorze w trakcie tur 3 i 5 (bez osobnych przerw) oraz na końcu.

**Kapitał i limit**
- Kapitał startowy: 10 000 zł na zespół.
- Limit 40% w jednej pozycji. Nie dotyczy gotówki. Obecnie limit obejmuje obligacje, a zmienia się to w `config.positionLimitExemptTypes`.

**Aktywa**
- Śledzie do namiotu (gotówka): ok. -1,5% na kwartał (inflacja).
- Obligacje Komendy: baza +2% na kwartał. Stopę zmieniają eventy (np. wybory komendanta ±1 pkt). Nie ma ryzyka niewypłacalności.
- Indeks CHORĄGIEW (ETF):
  - rośnie wolno, ale ma spadki,
  - symuluje koszyk 6 drużyn i „reszty”,
  - musi **wyraźnie reagować** na drużyny: drużyna robi +20%, to ETF ok. +10%; drużyna robi -45%, to ETF ok. -5%,
  - musi być **atrakcyjny**, a nie blady przy stabilnej drużynie typu +10/+12/-8/-2.
- Drużyny jako akcje, łącznie **6**:
  - **18 DSH Trop** (jedyna prawdziwa),
  - **5 fikcyjnych**, wzorowanych na prawdziwych, medialnych sytuacjach harcerskich. Nazwy nie mogą przypominać realnych drużyn. „Andromeda” zmieniamy (np. na „Kasjopeja”), jeśli jest prawdziwa.
  - Obecna zaślepka w `scenario.json` ma omyłkowo 23 drużyny („Drużyna A–W”). Do poprawienia przy podmianie scenariusza.
- Fundusz Pewniak: oferta „gwarantowanego” zysku w jednej turze (w v1 była to T3), w następnej turze wartość spada do 0.

**Wyniki symulacji v2 (charakter do zachowania)**
- ETF ok. +43%, z wyraźnym spadkiem w T4 (ok. -9,5%), kiedy tracą dwie drużyny.
- Zrównoważone portfele: +39–43%.
- „Hype” i gonienie lidera: +24–27%.
- Panika po spadku: +16%.
- Same obligacje: +15%.
- Same Śledzie: -9%.
- Pojedyncze drużyny mogą pobić ETF (Trop ok. +56%), ale z dużym ryzykiem.
- Scenariusza NIE ustawiamy tak, żeby ETF wygrywał zawsze, bo debrief uczyłby fałszu. Rozsądne strategie mają wychodzić dobrze, a skrajne mieć ogromny rozrzut.

**Newsy**
- Ok. 5 na turę: 4 o drużynach i 1 globalny.
- Event globalny to co innego niż **BIWAK**. Przy BIWAKU ważne jest, kto go organizuje, kto bierze udział i jakie miejsce zajął. Na razie BIWAK w aplikacji to tylko news wpływający na ceny. Zespoły nie zapisują się na niego w aplikacji.
- Każdy news ma trzy części:
  - 2–3 zdania żartobliwego opisu,
  - 1 zdanie „z czego wynika” (np. młody drużynowy z głową pełną pomysłów, ale bez doświadczenia, i trudna sytuacja z komendą: potencjał, ale ryzyko),
  - krótkie podsumowanie na dole.
- **Bez etykiet „kryzys/odbicie”**, bo wnioski wyciągają gracze. Ok. 1/4 newsów kończy się wbrew przesłankom. Nie każda drużyna ma news w każdej turze.
- Ton: tylko lekkie lub zabawne negatywy (pogoda, „profilaktyczna ewakuacja” obozu, zgubiony sprzęt, spór o termin, odwołany autokar). Bez wypadków, tragedii, zarzutów, nadużyć i polityki.
- Inspiracje z realnych wydarzeń jako fikcyjne newsy: Betlejemskie Światło Pokoju, rekordowa flaga w Krakowie, pomoc harcerzy przy powodzi i sponsor latarek, nagroda dla „ZHP dla Ukrainy”, ewakuacje obozów przed burzami.

**Zagadki**
- 6 kart w terenie, +250 zł za każdą, raz na zespół.
- **Cały zespół działa razem. Żadnego podziału na maklerów i zwiadowców** w UI ani w tekstach.
- Hasła z v1, do potwierdzenia: INFLACJA, DYWERSYFIKACJA, PROCENT SKŁADANY, BELKI, ETF, PIRAMIDA. W scenariuszu trzymać je jako `answerHashes` (narzędzie: `tools/hash-answer.mjs`).

**Bezpieczeństwo i prywatność**
- Bez danych osobowych: tylko nazwy zespołów i kody.

## 4. Stan aplikacji (etap 1 zrobiony)

**Stack**
- Statyczny HTML, CSS i ES modules bez kroku budowania.
- GitHub Pages (`main`, `/ (root)`, plik `.nojekyll` jest w repo).
- Supabase: tabele, RLS, RPC security definer, realtime. supabase-js ładowany z esm.sh.

**Ekrany**
- `index.html` — gracz.
- `host.html` — panel prowadzącego z PIN-em.
- `screen.html` — projektor.

**Moduły**
- `js/engine.js` — czysta logika. Event sourcing: stan liczony ze scenariusza i listy zdarzeń, kwoty w groszach.
- `js/scenario.js` — walidator.
- `js/store.js` — LocalStore (localStorage + BroadcastChannel) i SupabaseStore. Wybór w `js/config.js`: puste klucze oznaczają tryb lokalny, a `?store=local` w adresie wymusza tryb lokalny.
- `js/export.js` — CSV: separator `;`, przecinek dziesiętny, UTF-8 z BOM.

**Baza**
- `supabase/migrations/001_init.sql` tworzy tabele `games`, `game_secrets`, `teams`, `events` (append-only) oraz 14 RPC.
- `supabase/tests/smoke.sql` przeszedł na lokalnym Postgresie.

**Testy**
- `npm test` (`node --test`): 30/30, w tym symulacja pełnej gry 6 strategiami i zgodność rozpiski salda co do grosza.
- `tests/e2e/local.e2e.mjs` (Playwright, tryb lokalny): przeszedł.

**Treść gry**
- Wszystko jest w `data/scenario.json` i są to **zaślepki** (ok. 140 × „TODO”, losowe kursy, 4 zagadki zamiast 6).

**Zrobione funkcje**
- Gracz:
  - logowanie nazwą i 4-cyfrowym kodem, kilka telefonów na zespół,
  - kupno i sprzedaż (za kwotę albo ilość, w całych sztukach),
  - newsy i podsumowanie kwartału,
  - zagadki, zakładka „?”,
  - „Skąd się wzięło moje saldo”, dziennik transakcji.
- Panel:
  - gra, zespoły, kody do druku, „Nowy kod”,
  - start i koniec tury, odsłanianie rankingu,
  - dotacje i potrącenia, podgląd portfeli,
  - 2 eksporty CSV, reset (z opcją „zachowaj zespoły”), tryb testowy (tura 30 s).
- Projektor:
  - tura, zegar tury i miesiąca, event miesiąca,
  - newsy, kursy (3 kolumny), wykres SVG,
  - ranking po odsłonięciu.

## 5. Następne kroki (w tej kolejności)

1. **Podpiąć Supabase.**
   - Jędrzej ma projekt „skipp” w Supabase, ale połączenie MCP na claude.ai widziało tylko `Meduza_Supabase`, które jest innym projektem. **Nie używaj go.**
   - Potrzebne: Project URL i klucz publishable/anon (nigdy service_role).
   - Kroki: migracja (SQL Editor albo CLI), `admin_init_game('gielda','<PIN>',6)`, klucze do `js/config.js`.
   - Przed wykonaniem migracji na zdalnym projekcie zapytaj Jędrzeja.
2. **Załatać dwie dziury.**
   - **Przyszłe kursy są jawne.** Strona jest statyczna, więc `scenario.json` z cenami na wszystkie tury da się podejrzeć, a gracze to studenci. Trzeba trzymać kursy i newsy przyszłych tur w bazie (np. `game_secrets` lub tabela scenariusza za RPC) i wydawać klientom tylko bieżącą oraz minione tury. Panel prowadzącego wgrywa scenariusz do bazy. Plik w repo zostaje bez prawdziwych kursów albo nie jest commitowany (np. wgrywany lokalnie w panelu).
   - **Zgadywanie kodów.** 4 cyfry bez blokady (jest tylko limit 20 operacji na 5 s na zespół). Dodać blokadę po kilku nieudanych logowaniach albo dłuższe kody.
3. **Przetestować SupabaseStore na żywo.** Nigdy nie był uruchomiony, bo proxy w sesji chmurowej blokował esm.sh. Zrobić próbną turę w trybie testowym na 2 telefonach i projektorze.
4. **Wgrać prawdziwy scenariusz.**
   - Scenariusz v3 (kursy 9 aktywów × 6 tur, katalog newsów, eventy miesięczne, Pewniak, 6 zagadek, słowniczek) powstaje w innej rozmowie. Jędrzej dostarczy go jako JSON lub Excel.
   - Przekonwertować do formatu z `docs/SCENARIO.md`, uruchomić walidator i `npm test`.
   - Sprawdzić, że wyniki strategii zgadzają się z sekcją 3. Najlepiej dodać test symulacji, który pilnuje tych przedziałów.
   - Aplikacja i Excel planu B muszą liczyć z tych samych liczb.
5. Włączyć GitHub Pages (robi to Jędrzej ręcznie: Settings → Pages → `main`, `/ (root)`).

**Drobne decyzje do potwierdzenia z Jędrzejem**
- Czy limit 40% ma obejmować obligacje.
- Czy inflacja ma liczyć się tylko od dodatniego salda (tak jest teraz).
- Czy handel ma być w całych sztukach (tak jest teraz).
- Serwer nie blokuje salda przy zapisie. Za duża transakcja jest odrzucana przy przeliczeniu stanu i oznaczana jako „odrzucona”. Zostawić czy walidować w RPC?

## 6. Harmonogram

| Data | Co |
|---|---|
| 23.11 | konspekt do Zespołu Programowego (termin), materiały planu B |
| 24–26.11 | Supabase, łatki, scenariusz w aplikacji |
| 26.11 wieczór | **go/no-go** aplikacji |
| 27–28.11 | poprawki i test (Jędrzej testuje sam) |
| 28.11 do południa | pliki do druku |
| 29.11 | laminowanie, decyzja pogodowa (zagadki w holu, jeśli zła pogoda) |
| 30.11 20:00 | zbiórka |

## 7. Jak pracować w tym repo

- Uruchomienie lokalne: `npm run serve`, potem `http://localhost:8000/host.html`, `index.html` i `screen.html`. Testy: `npm test`.
- Po każdej zmianie logiki: `npm test`. Po zmianie UI: przeklikaj tryb lokalny (najlepiej e2e z Playwright).
- Zero treści gry w kodzie. Wszystko idzie przez `data/scenario.json` (albo przez bazę po łatce z kroku 2).
- Commity na `main` są OK. Remote: `https://github.com/Kropunio/SKIPP-Gielda.git`.
- Nie dotykaj projektu `Meduza_Supabase`. Nigdy nie commituj klucza service_role ani PIN-u.
- UI i teksty po polsku, kwoty w formacie `1 234,56 zł`.
