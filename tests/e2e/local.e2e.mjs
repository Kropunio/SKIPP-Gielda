// Test end-to-end trybu lokalnego (LocalStore) w przeglądarce headless (Playwright).
// Nie jest uruchamiany przez `node --test` (wymaga Playwright i Chrome).
// Użycie:  python3 -m http.server 8123 &   then   node tests/e2e/local.e2e.mjs [http://localhost:8123] [katalog-zrzutów]
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright z lokalnego node_modules albo globalnej instalacji (NODE_PATH=$(npm root -g)).
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

const BASE = process.argv[2] || 'http://localhost:8123';
const SHOTS = process.argv[3] || '/tmp/gielda-shots';
mkdirSync(SHOTS, { recursive: true });

const errors = [];
const launchOpts = { headless: true };
try { readFileSync('/usr/bin/google-chrome'); launchOpts.executablePath = '/usr/bin/google-chrome'; } catch { /* domyślny chromium */ }
const browser = await chromium.launch(launchOpts);
const context = await browser.newContext({ acceptDownloads: true });
const watch = (page, name) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
};
const step = (s) => console.log('•', s);

// ---- panel prowadzącego
const host = await context.newPage();
watch(host, 'host');
await host.setViewportSize({ width: 1280, height: 900 });
await host.goto(`${BASE}/host.html`);
step('tworzenie gry');
await host.fill('#p1', '1234');
await host.fill('#p2', '1234');
await host.click('#setup button[type=submit]');
await host.waitForSelector('#addteam');
for (const name of ['Alfa', 'Bravo', 'Charlie']) {
  await host.fill('#tname', name);
  await host.click('#addteam button[type=submit]');
  await host.waitForFunction((n) => [...document.querySelectorAll('td b')].some((b) => b.textContent === n), name);
}
const codes = await host.$$eval('.code', (els) => els.map((e) => e.textContent));
if (codes.length !== 3) throw new Error('brak kodów zespołów');
step(`kody: ${codes.join(', ')}`);
await host.click('[data-act=start]');
await host.waitForFunction(() => /\d:\d\d/.test(document.querySelector('#hclk')?.textContent));

// ---- projektor
const screen = await context.newPage();
watch(screen, 'screen');
await screen.setViewportSize({ width: 1600, height: 900 });
await screen.goto(`${BASE}/screen.html`);
await screen.waitForSelector('.s-prices .p');

// ---- gracz (telefon)
const phone = await context.newPage();
watch(phone, 'player');
await phone.setViewportSize({ width: 390, height: 844 });
await phone.goto(`${BASE}/index.html`);
step('logowanie gracza');
await phone.selectOption('#lteam', 'Alfa');
await phone.fill('#lcode', codes[0] === '0000' ? '1111' : '0000');
await phone.click('#login button[type=submit]');
await phone.waitForSelector('.toast.bad');
await phone.fill('#lcode', codes[0]);
await phone.click('#login button[type=submit]');
await phone.waitForSelector('.topbar');
await phone.screenshot({ path: `${SHOTS}/player-portfel.png`, fullPage: true });

step('kupno indeksu za kwotę');
await phone.click('[data-tab=rynek]');
await phone.screenshot({ path: `${SHOTS}/player-rynek.png`, fullPage: true });
await phone.click('[data-asset=idx]');
await phone.fill('#tval', '2000');
await phone.waitForFunction(() => !document.querySelector('#tgo').disabled);
await phone.screenshot({ path: `${SHOTS}/player-trade.png` });
await phone.click('#tgo');
await phone.waitForSelector('.toast.ok');

step('limit pozycji blokuje zbyt duży zakup');
await phone.click('[data-asset=d01]');
await phone.fill('#tval', '5000');
await phone.waitForFunction(() => document.querySelector('#tprev .err')?.textContent.includes('Limit'));
await phone.click('[data-q="1"]');
await phone.waitForFunction(() => !document.querySelector('#tgo').disabled);
await phone.click('#tgo');
await phone.waitForFunction(() => document.querySelectorAll('.toast.ok').length >= 2);

step('sprzedaż za ilość');
await phone.click('[data-asset=idx]');
await phone.click('#tside [data-side=sell]');
await phone.click('#tmode [data-mode=qty]');
await phone.fill('#tval', '1');
await phone.waitForFunction(() => !document.querySelector('#tgo').disabled);
await phone.click('#tgo');
await phone.waitForFunction(() => document.querySelectorAll('.toast.ok').length >= 3);

step('zagadka');
await phone.click('[data-tab=zagadki]');
await phone.fill('form[data-puzzle=z1] input', 'zle haslo');
await phone.click('form[data-puzzle=z1] button');
await phone.waitForFunction(() => [...document.querySelectorAll('.toast.bad')].some((t) => t.textContent.includes('hasło')));
await phone.fill('form[data-puzzle=z1] input', '  HASŁO jeden ');
await phone.click('form[data-puzzle=z1] button');
await phone.waitForSelector('form[data-puzzle=z1] .badge.ok');
await phone.screenshot({ path: `${SHOTS}/player-zagadki.png`, fullPage: true });

step('newsy, dziennik, pomoc');
for (const t of ['newsy', 'dziennik', 'pomoc']) {
  await phone.click(`[data-tab=${t}]`);
  await phone.screenshot({ path: `${SHOTS}/player-${t}.png`, fullPage: true });
}
const logText = await phone.textContent('#main');
if (!/Kupno/.test(logText) && !/Słowniczek/.test(logText)) throw new Error('brak treści zakładek');

step('rozpiska salda');
await phone.click('[data-tab=portfel]');
await phone.click('[data-act=breakdown]');
await phone.waitForSelector('dialog .breakdown');
const bd = await phone.textContent('dialog .breakdown');
if (!bd.includes('Razem') || !bd.includes('Dotacje za zagadki')) throw new Error('rozpiska niepełna');
if (await phone.$('dialog .err')) throw new Error('rozpiska niespójna');
await phone.screenshot({ path: `${SHOTS}/player-saldo.png` });
await phone.click('dialog .x');

step('drugi telefon tego samego zespołu');
const phone2 = await context.newPage();
watch(phone2, 'player2');
await phone2.setViewportSize({ width: 390, height: 844 });
await phone2.goto(`${BASE}/index.html`);
await phone2.waitForSelector('.topbar'); // ta sama przeglądarka → ta sama sesja
const v1 = await phone.textContent('.topbar .value');
const v2 = await phone2.textContent('.topbar .value');
if (v1 !== v2) throw new Error(`różne wartości portfela na dwóch kartach: ${v1} vs ${v2}`);

step('korekta prowadzącego');
await host.selectOption('#ateam', { label: 'Bravo' });
await host.fill('#aamount', '250,50');
await host.fill('#anote', 'Za porządek w sali');
await host.click('#adjust button[type=submit]');
await host.waitForSelector('.toast.ok');

await screen.screenshot({ path: `${SHOTS}/screen-open.png` });
step('zamknięcie tury i ranking');
await host.click('[data-act=close]');
await host.click('dialog [data-a=yes]');
await host.waitForFunction(() => document.querySelector('[data-act=start]') && !document.querySelector('[data-act=start]').disabled);
await host.click('[data-act=ranking]');
await screen.waitForSelector('.s-ranking');
await phone.waitForFunction(() => document.body.textContent.includes('Ranking'));
await screen.screenshot({ path: `${SHOTS}/screen-ranking.png` });
await host.screenshot({ path: `${SHOTS}/host.png`, fullPage: true });

step('eksport CSV');
const [dl] = await Promise.all([host.waitForEvent('download'), host.click('[data-act=csv-trades]')]);
const csv = readFileSync(await dl.path(), 'utf8');
if (!csv.startsWith('\ufeff') || !csv.includes(';')) throw new Error('CSV bez BOM / separatora');
const [dl2] = await Promise.all([host.waitForEvent('download'), host.click('[data-act=csv-portfolios]')]);
const csv2 = readFileSync(await dl2.path(), 'utf8');
if (!csv2.includes('po turze 1')) throw new Error('CSV portfeli bez stanu po turze 1');

step('tryb testowy: tura 30 s, handel blokuje się po czasie');
await host.click('[data-act=testmode]');
await host.waitForFunction(() => document.querySelector('[data-act=start]').textContent.includes('0:30'));
await host.click('[data-act=start]');
await phone.click('[data-tab=rynek]');
await phone.waitForFunction(() => /0:[0-3]\d/.test(document.querySelector('#clk').textContent));
await screen.screenshot({ path: `${SHOTS}/screen-test-mode.png` });

step('ekran projektora — sprawdzenie elementów');
const hasChart = await screen.$('.s-chart svg, .s-ranking');
if (!hasChart) throw new Error('brak wykresu/rankingu na projektorze');

await browser.close();
if (errors.length) {
  console.error('Błędy konsoli:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`OK — zrzuty ekranu w ${SHOTS}`);
