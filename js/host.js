// Panel prowadzącego (PIN): gra, zespoły i kody, tury, ranking, korekty, podgląd portfeli, eksport CSV, reset.
import { boot } from './app.js';
import { PHASE, portfolio, ranking, turnClock, getAsset, isUnitAsset, balanceBreakdown } from './engine.js';
import { escapeHtml, formatMoney, formatClock, formatTime, formatInt, parseMoneyInput } from './format.js';
import { $, toast, openDialog, confirmDialog, rerender, breakdownHtml, rankingHtml, PHASE_LABEL, qtyLabel, IDLE_CLOCK } from './ui.js';
import { portfoliosCsv, transactionsCsv } from './export.js';

const root = document.getElementById('root');
let ctx = null;
let pin = null;
let pinKey, codesKey;
let synced = false;

boot({ onUpdate: () => render() }).then((c) => {
  ctx = c;
  pinKey = `gielda:pin:${ctx.store.gameId}`;
  codesKey = `gielda:codes:${ctx.store.gameId}`;
  pin = sessionStorage.getItem(pinKey);
  render();
  if (pin) verifyPin(pin, true);
  setInterval(tick, 500);
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
}).catch((e) => console.error(e));

const codes = () => { try { return JSON.parse(localStorage.getItem(codesKey) || '{}'); } catch { return {}; } };
const saveCode = (teamId, code) => { const c = codes(); c[teamId] = code; localStorage.setItem(codesKey, JSON.stringify(c)); };

async function verifyPin(p, silent = false) {
  try {
    await ctx.store.hostCheck(p);
    pin = p;
    sessionStorage.setItem(pinKey, p);
    if (!synced) {
      await ctx.store.hostSyncScenario(p, ctx.scenario);
      synced = true;
    }
    render();
  } catch (e) {
    pin = null;
    sessionStorage.removeItem(pinKey);
    if (!silent) toast(e.message, 'bad');
    render();
  }
}

async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok');
    return r;
  } catch (e) {
    toast(e.message, 'bad');
    if (/PIN/.test(e.message)) { pin = null; sessionStorage.removeItem(pinKey); render(); }
    return undefined;
  }
}

// ------------------------------------------------------------------ render

function render() {
  if (!ctx || !pinKey) return;
  const g = ctx.game;
  if (!g) return rerender(root, ctx.store.mode === 'local' ? viewSetupLocal() : viewSetupSupabase());
  if (!pin) return rerender(root, viewPin());
  rerender(root, viewPanel());
  tick();
}

function header() {
  const s = ctx.scenario;
  return `<div class="row between" style="margin-bottom:1rem">
    <div><h1>${escapeHtml(s.meta.title)} — panel prowadzącego</h1>
      <div class="muted small">${escapeHtml(ctx.store.label)} · gra „${escapeHtml(ctx.store.gameId)}”${ctx.store.status === 'offline' ? ' · <span class="warn">brak połączenia</span>' : ''}</div></div>
    <div class="row"><a class="btn small" href="index.html${location.search}" target="_blank">Ekran gracza ↗</a><a class="btn small" href="screen.html${location.search}" target="_blank">Projektor ↗</a>
      ${pin ? '<button class="small ghost" data-act="logout">Wyloguj</button>' : ''}</div></div>`;
}

function viewSetupLocal() {
  return `${header()}<form class="card stack" id="setup" style="max-width:480px">
    <h2>Utwórz grę</h2>
    <p class="muted">Tryb lokalny: gra działa tylko w tej przeglądarce (kilka kart: panel, projektor, gracze). Do gry na wielu telefonach podepnij Supabase (docs/SETUP.md).</p>
    <label for="p1">PIN prowadzącego (min. 4 znaki)</label><input id="p1" type="password" autocomplete="new-password" required minlength="4">
    <label for="p2">Powtórz PIN</label><input id="p2" type="password" autocomplete="new-password" required minlength="4">
    <button class="primary block" type="submit">Utwórz grę</button></form>`;
}

function viewSetupSupabase() {
  return `${header()}<section class="card stack" style="max-width:640px"><h2>Gra nie jest jeszcze zainicjalizowana</h2>
    <p>W Supabase otwórz <b>SQL Editor</b> i wykonaj (z własnym PIN-em):</p>
    <pre class="card flat" style="white-space:pre-wrap">select public.admin_init_game('${escapeHtml(ctx.store.gameId)}', 'TWÓJ-PIN', ${ctx.scenario.config.turns});</pre>
    <p class="muted">Szczegóły: docs/SETUP.md. Strona odświeży się sama.</p></section>`;
}

function viewPin() {
  return `${header()}<form class="card stack" id="pinform" style="max-width:420px">
    <h2>Zaloguj się PIN-em</h2>
    <input id="pin" type="password" autocomplete="current-password" required placeholder="PIN" data-keep="pin">
    <button class="primary block" type="submit">Wejdź</button></form>`;
}

function viewPanel() {
  const s = ctx.scenario;
  const st = ctx.state;
  const g = ctx.game;
  const cfg = s.config;
  const turns = cfg.turns;
  const nextTurn = st.phase === PHASE.LOBBY ? 1 : st.turn + 1;
  const duration = g.testMode ? cfg.testTurnSeconds : cfg.turnSeconds;
  const canStart = (st.phase === PHASE.LOBBY || st.phase === PHASE.CLOSED) && nextTurn <= turns;
  const canClose = st.phase === PHASE.OPEN;
  const td = st.turn ? s.turns[st.turn - 1] : null;
  const rk = ranking(s, st);
  const warnings = ctx.warnings.map((w) => `<li class="warn">${escapeHtml(w)}</li>`).join('');

  // ---- sterowanie grą
  const control = `<section class="card stack">
    <div class="row between"><h2>Gra</h2><span class="badge ${st.phase === PHASE.OPEN ? 'ok' : 'warn'}">${escapeHtml(PHASE_LABEL[st.phase])}</span></div>
    <div class="row between">
      <div><div class="muted small">${td ? `${escapeHtml(td.label)} · tura ${st.turn}/${turns}` : `0/${turns} tur`}</div><div class="bigclock" id="hclk"></div><div class="muted" id="hmclk"></div></div>
      <div class="stack" style="min-width:220px">
        <button class="primary block" data-act="start" ${canStart ? '' : 'disabled'}>▶ Start tury ${nextTurn <= turns ? nextTurn : ''} (${formatClock(duration * 1000)})</button>
        <button class="sell block" data-act="close" ${canClose ? '' : 'disabled'}>■ Zakończ turę ${canClose ? st.turn : ''}</button>
      </div>
    </div>
    <div class="row">
      <button class="${g.rankingVisible ? 'primary' : ''}" data-act="ranking">${g.rankingVisible ? '👁 Ranking odsłonięty — ukryj' : 'Odsłoń ranking'}</button>
      <button class="${g.testMode ? 'primary' : ''}" data-act="testmode">Tryb testowy (tura ${cfg.testTurnSeconds} s): ${g.testMode ? 'WŁ.' : 'wył.'}</button>
    </div>
    <p class="muted small">Plan odsłonięcia rankingu: po turach ${escapeHtml((cfg.rankingPlannedTurns || []).join(', ') || '—')} i na koniec. Po upływie czasu handel blokuje się sam, ale turę zamykasz Ty — wtedy wchodzą nowe ceny, inflacja i odsetki.</p>
    ${warnings ? `<ul class="small">${warnings}</ul>` : ''}
  </section>`;

  // ---- zespoły
  const cs = codes();
  const teamRows = ctx.snapshot.teams.map((t) => `<tr><td><b>${escapeHtml(t.name)}</b></td>
    <td>${cs[t.id] ? `<span class="code">${escapeHtml(cs[t.id])}</span>` : '<span class="muted small">nieznany na tym urządzeniu</span>'}</td>
    <td class="right"><button class="small" data-act="regen" data-team="${t.id}">Nowy kod</button>
      <button class="small danger" data-act="delteam" data-team="${t.id}">Usuń</button></td></tr>`).join('');
  const teamsCard = `<section class="card stack">
    <div class="row between"><h2>Zespoły (${ctx.snapshot.teams.length})</h2><button class="small" data-act="print" ${ctx.snapshot.teams.length ? '' : 'disabled'}>🖨 Drukuj kody</button></div>
    <form id="addteam" class="row"><input class="grow" style="width:auto" id="tname" data-keep="tname" placeholder="Nazwa zespołu, np. ${escapeHtml('Zespół 1')}" maxlength="40" required><button class="primary" type="submit">Dodaj</button></form>
    ${teamRows ? `<table><thead><tr><th>Zespół</th><th>Kod</th><th></th></tr></thead><tbody>${teamRows}</tbody></table>` : '<p class="muted">Dodaj 3–5 zespołów. Kody (4 cyfry) widać tylko tutaj — wydrukuj je lub zapisz.</p>'}
    <p class="muted small">Kody są przechowywane jako hash — panel pamięta je tylko na urządzeniu, na którym je utworzono. Zgubiony kod: „Nowy kod”.</p>
  </section>`;

  // ---- korekty
  const teamOpts = ctx.snapshot.teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  const adjustCard = `<section class="card stack">
    <h2>Dotacja / potrącenie</h2>
    <form id="adjust" class="stack">
      <div class="row"><select id="ateam" data-keep="ateam" class="grow" style="width:auto" required><option value="">— zespół —</option>${teamOpts}</select>
        <select id="asign" data-keep="asign" style="width:auto"><option value="1">+ dotacja</option><option value="-1">− potrącenie</option></select></div>
      <div class="row"><input id="aamount" data-keep="aamount" inputmode="decimal" placeholder="Kwota (zł)" class="grow" style="width:auto" required>
        <input id="anote" data-keep="anote" placeholder="Opis (widoczny dla zespołu)" class="grow" style="width:auto" maxlength="200" required></div>
      <button class="primary" type="submit">Zapisz korektę</button>
    </form></section>`;

  // ---- portfele
  const idx = st.priceIndex;
  const rows = rk.map((r) => {
    const t = st.teams.get(r.teamId);
    const p = portfolio(s, t, idx);
    const pos = p.positions.map((x) => `${escapeHtml(x.asset.ticker || x.asset.name)} ${isUnitAsset(x.asset) ? formatInt(x.qty) : escapeHtml(formatMoney(x.qty, { decimals: 0 }))}`).join(' · ');
    const rejected = t.log.filter((e) => e.kind === 'trade' && !e.ok).length;
    const solved = Object.keys(t.solved).length;
    return `<tr class="clickable" data-act="team" data-team="${t.id}"><td>${r.rank}</td><td><b>${escapeHtml(t.name)}</b></td>
      <td class="num">${escapeHtml(formatMoney(t.cash))}</td><td class="small">${pos || '<span class="muted">—</span>'}</td>
      <td class="num">${solved}/${s.puzzles.length}</td><td class="num">${rejected || ''}</td><td class="num"><b>${escapeHtml(formatMoney(r.total))}</b></td></tr>`;
  }).join('');
  const portfolios = `<section class="card stack wide">
    <div class="row between"><h2>Portfele zespołów</h2><span class="muted small">ranking ${g.rankingVisible ? 'widoczny dla graczy' : 'ukryty przed graczami'} · kliknij wiersz, by zobaczyć rozpiskę</span></div>
    <div class="scroll-x"><table><thead><tr><th>#</th><th>Zespół</th><th class="num">Gotówka</th><th>Pozycje</th><th class="num">Zagadki</th><th class="num">Odrzucone</th><th class="num">Wartość</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted">Brak zespołów.</td></tr>'}</tbody></table></div>
    <div class="row"><button data-act="csv-portfolios">⬇ CSV: stan portfeli po turach</button><button data-act="csv-trades">⬇ CSV: wszystkie transakcje</button></div>
  </section>`;

  // ---- dziennik zdarzeń
  const teamName = (id) => st.teams.get(id)?.name ?? '—';
  const evRows = [...ctx.snapshot.events].reverse().slice(0, 80).map((e) => {
    const r = st.results.get(e.id);
    const p = e.payload || {};
    let what = '';
    if (e.type === 'turn') what = p.action === 'start' ? `▶ start tury ${p.turn} (${p.duration} s)` : `■ koniec tury ${p.turn}`;
    else if (e.type === 'trade') {
      const a = getAsset(s, p.asset);
      what = `${p.side === 'buy' ? 'kupno' : 'sprzedaż'} ${a ? a.name : p.asset}: ${a ? qtyLabel(a, p.qty) : p.qty}`;
    } else if (e.type === 'puzzle') what = `zagadka ${s.puzzles.find((z) => z.id === p.puzzle)?.title ?? p.puzzle}`;
    else if (e.type === 'adjustment') what = `korekta ${formatMoney(p.amount, { sign: true })} — ${p.note || ''}`;
    return `<tr><td class="small num">${escapeHtml(formatTime(e.at))}</td><td class="small">${e.turn ?? ''}</td><td>${e.teamId ? escapeHtml(teamName(e.teamId)) : '<span class="muted">prowadzący</span>'}</td>
      <td>${escapeHtml(what)}</td><td>${r?.ok ? '<span class="badge ok">OK</span>' : `<span class="badge bad" title="${escapeHtml(r?.error || '')}">odrzucone</span> <span class="small muted">${escapeHtml(r?.error || '')}</span>`}</td></tr>`;
  }).join('');
  const log = `<section class="card stack wide"><h2>Dziennik zdarzeń (ostatnie 80)</h2>
    <div class="eventlog scroll-x"><table><tbody>${evRows || '<tr><td class="muted">Brak zdarzeń.</td></tr>'}</tbody></table></div></section>`;

  // ---- reset
  const danger = `<section class="card stack wide" style="border-color:var(--down)"><h2>Reset gry</h2>
    <form id="reset" class="row">
      <label class="row" style="margin:0"><input type="checkbox" id="rkeep" checked style="width:auto;min-height:0"> zachowaj zespoły i kody</label>
      <label class="row" style="margin:0"><input type="checkbox" id="rtest" ${g.testMode ? 'checked' : ''} style="width:auto;min-height:0"> tryb testowy</label>
      <button class="danger" type="submit">Resetuj grę (usuwa wszystkie transakcje)</button>
      ${ctx.store.mode === 'local' ? '<button class="danger" type="button" data-act="destroy">Usuń grę z tej przeglądarki</button>' : ''}
    </form>
    <p class="muted small">Przed grą: przetestuj w trybie testowym, potem zresetuj z zachowaniem zespołów.</p></section>`;

  return `${header()}<div class="host-grid">${control}${teamsCard}${portfolios}${adjustCard}
    <section class="card stack"><h2>Ranking (podgląd)</h2>${rankingHtml(rk)}</section>${log}${danger}</div>`;
}

function tick() {
  if (!ctx?.state || !$('#hclk')) return;
  const st = ctx.state;
  const c = turnClock(st.turnStartedAt, st.turnDuration, ctx.store.now(), ctx.scenario.config.monthsPerTurn);
  if (st.phase === PHASE.OPEN && c.running) {
    $('#hclk').textContent = formatClock(c.remaining);
    $('#hclk').classList.toggle('down', c.expired);
    const td = ctx.scenario.turns[st.turn - 1];
    $('#hmclk').textContent = c.expired ? 'Czas minął — handel zablokowany. Zamknij turę.' : `${td?.months[c.month - 1]?.name || 'Miesiąc'} (${c.month}/${ctx.scenario.config.monthsPerTurn}) · ${formatClock(c.monthRemaining)}`;
  } else {
    $('#hclk').textContent = IDLE_CLOCK[st.phase] || '';
    $('#hmclk').textContent = '';
  }
}

// ------------------------------------------------------------------ akcje

async function onSubmit(e) {
  const id = e.target.id;
  if (!['setup', 'pinform', 'addteam', 'adjust', 'reset'].includes(id)) return;
  e.preventDefault();
  const s = ctx.scenario;
  if (id === 'setup') {
    const p1 = $('#p1').value, p2 = $('#p2').value;
    if (p1 !== p2) return toast('PIN-y się różnią.', 'bad');
    const ok = await act(() => ctx.store.hostSetup(p1, s.config.turns), 'Gra utworzona.');
    if (ok !== undefined || ctx.game) await verifyPin(p1);
  } else if (id === 'pinform') {
    await verifyPin($('#pin').value);
  } else if (id === 'addteam') {
    const input = $('#tname');
    const r = await act(() => ctx.store.hostCreateTeam(pin, input.value), (t) => `Dodano zespół ${t.name} — kod ${t.code}`);
    if (r) { saveCode(r.id, r.code); $('#tname').value = ''; render(); }
  } else if (id === 'adjust') {
    const team = $('#ateam').value;
    const amount = parseMoneyInput($('#aamount').value) * Number($('#asign').value);
    const note = $('#anote').value.trim();
    if (!team) return toast('Wybierz zespół.', 'bad');
    if (!Number.isFinite(amount) || amount === 0) return toast('Podaj poprawną kwotę, np. 250 lub 99,50.', 'bad');
    const name = ctx.state.teams.get(team)?.name;
    const r = await act(() => ctx.store.hostAdjust(pin, team, amount, note), `${name}: ${formatMoney(amount, { sign: true })}`);
    if (r !== undefined) { $('#aamount').value = ''; $('#anote').value = ''; }
  } else if (id === 'reset') {
    const keepTeams = $('#rkeep').checked;
    const testMode = $('#rtest').checked;
    if (!(await confirmDialog('Reset gry', `Usunąć wszystkie transakcje, zagadki i korekty${keepTeams ? '' : ' oraz zespoły'}? Tego nie da się cofnąć. Najpierw możesz pobrać CSV.`, 'Resetuj', true))) return;
    await act(() => ctx.store.hostReset(pin, { keepTeams, testMode }), 'Gra zresetowana.');
    if (!keepTeams) localStorage.removeItem(codesKey);
  }
}

async function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  const s = ctx.scenario;
  const st = ctx.state;
  const g = ctx.game;
  if (a === 'logout') { pin = null; sessionStorage.removeItem(pinKey); render(); }
  else if (a === 'start') {
    const duration = g.testMode ? s.config.testTurnSeconds : s.config.turnSeconds;
    el.disabled = true;
    await act(() => ctx.store.hostStartTurn(pin, duration), (t) => `Tura ${t} wystartowała.`);
  } else if (a === 'close') {
    const last = st.turn >= s.config.turns;
    if (!(await confirmDialog(`Zakończyć turę ${st.turn}?`, `Handel zostanie zablokowany, naliczona inflacja i odsetki, a wycena przejdzie na nowe ceny.${last ? ' To ostatnia tura — gra się zakończy.' : ''}`, 'Zakończ turę'))) return;
    await act(() => ctx.store.hostCloseTurn(pin), last ? 'Gra zakończona.' : `Tura ${st.turn} zamknięta.`);
  } else if (a === 'ranking') {
    await act(() => ctx.store.hostSetFlags(pin, { rankingVisible: !g.rankingVisible }), g.rankingVisible ? 'Ranking ukryty.' : 'Ranking odsłonięty.');
  } else if (a === 'testmode') {
    await act(() => ctx.store.hostSetFlags(pin, { testMode: !g.testMode }), `Tryb testowy ${g.testMode ? 'wyłączony' : 'włączony'} (dotyczy kolejnych tur).`);
  } else if (a === 'regen') {
    const t = ctx.snapshot.teams.find((x) => x.id === el.dataset.team);
    if (!(await confirmDialog('Nowy kod', `Wygenerować nowy kod dla „${t.name}”? Stary przestanie działać przy kolejnych akcjach — telefony zespołu trzeba będzie zalogować ponownie.`, 'Generuj'))) return;
    const code = await act(() => ctx.store.hostRegenCode(pin, t.id), (c) => `${t.name}: nowy kod ${c}`);
    if (code) { saveCode(t.id, code); render(); }
  } else if (a === 'delteam') {
    const t = ctx.snapshot.teams.find((x) => x.id === el.dataset.team);
    if (!(await confirmDialog('Usuń zespół', `Usunąć zespół „${t.name}” wraz z jego transakcjami?`, 'Usuń', true))) return;
    await act(() => ctx.store.hostDeleteTeam(pin, t.id), 'Zespół usunięty.');
  } else if (a === 'print') printCodes();
  else if (a === 'team') showTeam(el.dataset.team);
  else if (a === 'csv-portfolios') download(`gielda-portfele-${stamp()}.csv`, portfoliosCsv(s, st));
  else if (a === 'csv-trades') download(`gielda-transakcje-${stamp()}.csv`, transactionsCsv(s, st));
  else if (a === 'destroy') {
    if (!(await confirmDialog('Usuń grę', 'Usunąć grę (zespoły, zdarzenia, PIN) z tej przeglądarki?', 'Usuń', true))) return;
    await act(() => ctx.store.destroy(pin), 'Gra usunięta.');
    localStorage.removeItem(codesKey);
    pin = null; sessionStorage.removeItem(pinKey); synced = false; render();
  }
}

function showTeam(teamId) {
  const s = ctx.scenario;
  const st = ctx.state;
  const t = st.teams.get(teamId);
  if (!t) return;
  const b = balanceBreakdown(s, t, st.priceIndex);
  const p = portfolio(s, t, st.priceIndex);
  const pos = p.positions.map((x) => `<tr><td>${escapeHtml(x.asset.name)}</td><td class="num">${escapeHtml(qtyLabel(x.asset, x.qty))}</td><td class="num">${escapeHtml(formatMoney(x.value))}</td></tr>`).join('');
  openDialog(t.name, `<h3>Pozycje</h3><table><tbody><tr><td>Gotówka</td><td></td><td class="num">${escapeHtml(formatMoney(t.cash))}</td></tr>${pos}</tbody></table>
    <h3 style="margin-top:1rem">Skąd się wzięło saldo</h3>${breakdownHtml(s, t, st.priceIndex)}
    <p class="muted small">Kontrola: ${b.consistent ? '✔ rozpiska zgadza się z wartością portfela co do grosza' : '✖ niezgodność!'}</p>`);
}

function printCodes() {
  const s = ctx.scenario;
  const cs = codes();
  const url = new URL('index.html', location.href);
  url.search = location.search;
  document.getElementById('print').innerHTML = ctx.snapshot.teams.map((t) => `<div class="print-card">
    <p>${escapeHtml(s.meta.title)}</p><h2>${escapeHtml(t.name)}</h2>
    <p>Kod zespołu:</p><div class="pc-code">${escapeHtml(cs[t.id] || '????')}</div>
    <p>Wejdź na: <b>${escapeHtml(url.href)}</b></p><p>Cały zespół może grać na kilku telefonach tym samym kodem.</p></div>`).join('');
  if (ctx.snapshot.teams.some((t) => !cs[t.id])) toast('Część kodów jest nieznana na tym urządzeniu — wygeneruj je ponownie („Nowy kod”).', 'bad');
  window.print();
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(name, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
