// Ekran gracza (telefon). Zespół loguje się nazwą + 4-cyfrowym kodem; wiele telefonów na zespół.
import { boot } from './app.js';
import {
  PHASE, getAsset, isUnitAsset, priceOf, priceChange, portfolio, balanceBreakdown, quoteTrade, maxBuyAmount,
  canBuyInTurn, canSellInTurn, tradeCtx, turnClock, turnContent, ranking, normalizeAnswer, rateOf, cashAsset, valueOf,
  startCapital, wealthSeries,
} from './engine.js';
import { escapeHtml, formatMoney, formatPercent, formatClock, formatTime, formatInt, parseMoneyInput } from './format.js';
import { $, text, toast, openDialog, rerender, breakdownHtml, rankingHtml, changeHtml, money, signedClass, PHASE_LABEL, qtyLabel, IDLE_CLOCK, wealthChartSvg } from './ui.js';

const root = document.getElementById('root');
let ctx = null;
let tab = 'portfel';
let session = null;
let sessionKey = null;
const pending = new Map(); // id zdarzenia → opis (czekamy na wynik replay)
let tradeDlg = null;
let lastExpired = null;

const TABS = [
  ['portfel', '💼', 'Portfel'],
  ['rynek', '📈', 'Rynek'],
  ['newsy', '📰', 'Newsy'],
  ['zagadki', '🧩', 'Zagadki'],
  ['dziennik', '📜', 'Dziennik'],
  ['pomoc', '❓', '?'],
];

// ------------------------------------------------------------------ start

boot({ onUpdate }).then((c) => {
  ctx = c;
  sessionKey = `gielda:session:${ctx.store.gameId}`;
  try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
  render();
  setInterval(tick, 500);
}).catch((e) => console.error(e));

function onUpdate(c) {
  ctx = c;
  if (!sessionKey) return; // pierwsze wywołanie przed ustawieniem sesji
  for (const [id, label] of pending) {
    const r = ctx.state.results.get(id);
    if (!r) continue;
    pending.delete(id);
    if (r.ok) toast(`✔ ${label}`, 'ok');
    else toast(`✖ ${label}: ${r.error}`, 'bad');
  }
  render();
  tradeDlg?.update();
}

const me = () => (session ? ctx.state.teams.get(session.teamId) : null);
const nowMs = () => ctx.store.now();
const clock = () => turnClock(ctx.state.turnStartedAt, ctx.state.turnDuration, nowMs(), ctx.scenario.config.monthsPerTurn);
const tradingOpen = () => ctx.state.phase === PHASE.OPEN && !clock().expired;

// ------------------------------------------------------------------ render

function render() {
  if (!ctx) return;
  if (session && !ctx.snapshot.teams.some((t) => t.id === session.teamId)) logout(false);
  if (!session) return renderLogin();
  if (!root.querySelector('.topbar')) {
    root.innerHTML = `<header class="topbar" id="top"></header><main id="main"></main>
      <nav class="tabs" id="tabs">${TABS.map(([id, ico, label]) => `<button data-tab="${id}"><span class="ico">${ico}</span>${label}</button>`).join('')}</nav>`;
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      tab = b.dataset.tab;
      window.scrollTo(0, 0);
      render();
    });
    $('#main').addEventListener('click', onMainClick);
    $('#main').addEventListener('submit', onMainSubmit);
  }
  for (const b of root.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  renderTop();
  const main = $('#main');
  const views = { portfel: viewPortfel, rynek: viewRynek, newsy: viewNewsy, zagadki: viewZagadki, dziennik: viewDziennik, pomoc: viewPomoc };
  rerender(main, views[tab]());
  lastExpired = clock().expired;
}

function renderTop() {
  const st = ctx.state;
  const t = me();
  const total = portfolio(ctx.scenario, t, st.priceIndex).total;
  const turns = ctx.scenario.config.turns;
  const td = st.turn ? ctx.scenario.turns[st.turn - 1] : null;
  let where = 'Przed startem gry';
  if (st.phase === PHASE.FINISHED) where = 'Koniec gry';
  else if (td) where = `${td.label} · tura ${st.turn}/${turns}`;
  let banner = '';
  if (st.phase === PHASE.LOBBY) banner = '<div class="banner closed">Czekamy na start gry. Handel ruszy, gdy prowadzący rozpocznie turę.</div>';
  else if (st.phase === PHASE.CLOSED) banner = '<div class="banner closed">Tura zamknięta — nowe ceny już obowiązują w wycenie. Czekamy na kolejną turę.</div>';
  else if (st.phase === PHASE.FINISHED) banner = '<div class="banner closed">Gra zakończona. Dziękujemy!</div>';
  else banner = '<div class="banner open" id="openbanner">Handel otwarty</div>';
  $('#top').innerHTML = `
    <div class="row between">
      <div><div class="team">${escapeHtml(t.name)}</div><div class="muted small">${escapeHtml(where)}</div></div>
      <div class="right"><div class="clock" id="clk"></div><div class="muted small" id="mclk"></div></div>
    </div>
    <div class="row between small" style="margin-top:.3rem">
      <span>Portfel: <b class="value">${escapeHtml(formatMoney(total))}</b></span>
      <span class="muted">Gotówka: ${escapeHtml(formatMoney(t.cash))}</span>
    </div>
    ${banner}`;
  tick();
}

function tick() {
  if (!ctx || !session || !$('#clk')) return;
  const st = ctx.state;
  const c = clock();
  const clk = $('#clk');
  const mclk = $('#mclk');
  if (st.phase === PHASE.OPEN && c.running) {
    clk.textContent = formatClock(c.remaining);
    clk.classList.toggle('expired', c.expired);
    const months = ctx.scenario.config.monthsPerTurn;
    const td = ctx.scenario.turns[st.turn - 1];
    const mName = td?.months[c.month - 1]?.name || `Miesiąc ${c.month}`;
    mclk.textContent = c.expired ? 'czas minął' : `${mName} (${c.month}/${months}) · ${formatClock(c.monthRemaining)}`;
    const ob = $('#openbanner');
    if (ob) {
      ob.textContent = c.expired ? 'Czas tury minął — handel zablokowany, czekamy na prowadzącego.' : 'Handel otwarty';
      ob.className = `banner ${c.expired ? 'closed' : 'open'}`;
    }
  } else {
    clk.textContent = IDLE_CLOCK[st.phase] || '';
    clk.classList.remove('expired');
    mclk.textContent = PHASE_LABEL[st.phase] || '';
  }
  if (lastExpired !== null && c.expired !== lastExpired) { lastExpired = c.expired; render(); tradeDlg?.update(); }
}

// ------------------------------------------------------------------ logowanie

function renderLogin() {
  const teams = [...ctx.snapshot.teams].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const meta = ctx.scenario.meta;
  rerender(root, `
    <div style="padding-top:2.5rem" class="stack">
      <div class="center">
        <h1>${escapeHtml(meta.title)}</h1>
        ${meta.subtitle ? `<p class="muted">${escapeHtml(meta.subtitle)}</p>` : ''}
      </div>
      <form class="card stack" id="login">
        <h2>Wejdź do gry</h2>
        ${!ctx.game ? '<p class="warn">Gra jeszcze nie została utworzona przez prowadzącego.</p>' : ''}
        ${teams.length ? `
          <div><label for="lteam">Zespół</label>
            <select id="lteam" data-keep="lteam" required><option value="">— wybierz —</option>${teams.map((t) => `<option>${escapeHtml(t.name)}</option>`).join('')}</select></div>
          <div><label for="lcode">Kod zespołu (6 cyfr)</label>
            <input id="lcode" data-keep="lcode" class="big" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="off" required placeholder="••••••"></div>
          <button class="primary block" type="submit">Wejdź</button>`
    : '<p class="muted">Prowadzący nie dodał jeszcze zespołów. Strona odświeży się sama.</p>'}
        <p class="muted small">Cały zespół gra razem — możecie zalogować się na kilku telefonach tym samym kodem.</p>
      </form>
      <p class="muted small center">${escapeHtml(ctx.store.label)}</p>
    </div>`);
  $('#login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#lteam').value;
    const code = $('#lcode').value.trim();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const t = await ctx.store.teamLogin(name, code);
      session = { teamId: t.id, name: t.name, code };
      localStorage.setItem(sessionKey, JSON.stringify(session));
      root.innerHTML = '';
      tab = 'portfel';
      render();
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
    }
  });
}

function logout(rerenderNow = true) {
  session = null;
  localStorage.removeItem(sessionKey);
  root.innerHTML = '';
  if (rerenderNow) render();
}

// ------------------------------------------------------------------ widoki

function viewPortfel() {
  const st = ctx.state;
  const s = ctx.scenario;
  const t = me();
  const idx = st.priceIndex;
  const p = portfolio(s, t, idx);
  const b = balanceBreakdown(s, t, idx);
  const start = startCapital(s);
  const diff = p.total - start;
  const cashA = cashAsset(s);
  const nextRateTurn = st.phase === PHASE.OPEN ? st.turn : Math.min(st.turn + 1, s.config.turns);
  const plOf = (id) => b.assets.find((a) => a.id === id)?.pl ?? 0;
  const rows = p.positions.map((pos) => {
    const pl = plOf(pos.asset.id);
    return `<tr><td><b>${escapeHtml(pos.asset.name)}</b><div class="muted small">${escapeHtml(qtyLabel(pos.asset, pos.qty))}${isUnitAsset(pos.asset) ? ` × ${escapeHtml(formatMoney(pos.price))}` : ''}</div></td>
      <td class="num">${escapeHtml(formatMoney(pos.value))}<div class="small ${signedClass(pl)}">${escapeHtml(formatMoney(pl, { sign: true }))}</div></td></tr>`;
  }).join('');
  return `
    <section class="card stack">
      <div class="muted small">Wartość portfela</div>
      <div class="bigvalue">${escapeHtml(formatMoney(p.total))}</div>
      <div class="${signedClass(diff)}">${escapeHtml(formatMoney(diff, { sign: true }))} (${escapeHtml(formatPercent(diff / start, { sign: true }))}) od startu</div>
      <button class="primary block" data-act="breakdown">Skąd się wzięło moje saldo?</button>
    </section>
    <section class="card" style="margin-top:.75rem">
      <div class="muted small">Historia wartości portfela</div>
      ${wealthChartSvg(wealthSeries(s, st), { teamIds: [t.id], highlightId: t.id, endLabels: 'value', startZl: start / 100, width: 360, height: 210 })}
    </section>
    <section class="card" style="margin-top:.75rem">
      <table><tbody>
        <tr><td><b>${escapeHtml(cashA.name)}</b><div class="muted small">gotówka · ${escapeHtml(formatPercent(rateOf(cashA, nextRateTurn), { sign: true }))} na koniec kwartału</div></td>
          <td class="num">${escapeHtml(formatMoney(t.cash))}</td></tr>
        ${rows || ''}
      </tbody></table>
      ${p.positions.length ? '' : '<p class="muted small">Nie masz jeszcze żadnych aktywów — zajrzyj na Rynek.</p>'}
    </section>
    ${ctx.game?.rankingVisible ? `<section class="card accent" style="margin-top:.75rem"><h2>Ranking</h2>${rankingHtml(ranking(s, st), t.id)}</section>` : ''}
    <div class="row between" style="margin-top:1.25rem">
      <span class="muted small">${escapeHtml(ctx.store.label)}${ctx.store.status === 'offline' ? ' · <span class="warn">brak połączenia</span>' : ''}</span>
      <button class="ghost small" data-act="logout">Wyloguj</button>
    </div>`;
}

function assetGroupKey(a) {
  const order = { bond: 1, index: 2, stock: 3, special: 4 };
  return `${order[a.type] ?? 9}|${a.group || ''}`;
}
function groupTitle(a) {
  if (a.group) return a.group;
  return { bond: 'Obligacje', index: 'Indeks', stock: 'Akcje', special: 'Oferty specjalne' }[a.type] || '';
}

function viewRynek() {
  const st = ctx.state;
  const s = ctx.scenario;
  const t = me();
  const open = st.phase === PHASE.OPEN;
  const idx = st.priceIndex;
  const turnForRules = open ? st.turn : st.turn + 1;
  let html = '';
  if (!open) html += `<p class="banner closed">Handel jest zamknięty. ${st.phase === PHASE.LOBBY ? 'Poniżej kursy na start.' : 'Poniżej aktualne kursy.'}</p>`;
  else if (clock().expired) html += '<p class="banner closed">Czas tury minął — handel zablokowany.</p>';
  // oferty specjalne dostępne w tej turze
  for (const a of s.assets) {
    if (a.offer && open && canBuyInTurn(a, st.turn)) {
      html += `<section class="card accent stack" style="margin-bottom:.75rem"><span class="badge accent">Oferta</span><h2>${escapeHtml(a.offer.title)}</h2><p>${text(a.offer.body)}</p>
        <button class="primary block" data-asset="${escapeHtml(a.id)}">Zobacz: ${escapeHtml(a.name)}</button></section>`;
    }
  }
  html += `<div class="card flat small">Gotówka: <b>${escapeHtml(formatMoney(t.cash))}</b> · limit: jedno aktywo maks. ${Math.round(s.config.positionLimit * 100)}% portfela</div>`;
  const assets = s.assets.filter((a) => a.type !== 'cash').sort((a, b) => assetGroupKey(a).localeCompare(assetGroupKey(b)));
  let lastGroup = null;
  html += '<div class="asset-list">';
  for (const a of assets) {
    const g = groupTitle(a);
    if (g !== lastGroup) { html += `<div class="group-title">${escapeHtml(g)}</div>`; lastGroup = g; }
    const held = t.holdings[a.id] || 0;
    const buyable = canBuyInTurn(a, turnForRules);
    const sellable = canSellInTurn(a, turnForRules);
    const locked = !buyable && !(sellable && held);
    const heldTxt = held ? `masz ${qtyLabel(a, held)}` : '';
    let right;
    if (isUnitAsset(a)) {
      right = `<div class="price num">${escapeHtml(formatMoney(priceOf(a, idx)))}</div><div class="right small">${changeHtml(priceChange(a, idx))}</div>`;
    } else {
      const rt = open ? st.turn : Math.min(st.turn + 1, s.config.turns);
      right = `<div class="price num up">${escapeHtml(formatPercent(rateOf(a, rt), { sign: true }))}</div><div class="right small muted">na kwartał</div>`;
    }
    const tags = [];
    if (!buyable) tags.push('kupno niedostępne');
    if (!sellable) tags.push('bez sprzedaży');
    html += `<button class="asset ${locked ? 'locked' : ''}" data-asset="${escapeHtml(a.id)}">
      <div><div class="name">${escapeHtml(a.name)} ${a.ticker ? `<span class="muted small">${escapeHtml(a.ticker)}</span>` : ''}</div>
      <div class="meta">${escapeHtml([heldTxt, ...tags].filter(Boolean).join(' · ') || ' ')}</div></div>
      <div>${right}</div></button>`;
  }
  html += '</div>';
  return html;
}

function viewNewsy() {
  const st = ctx.state;
  const s = ctx.scenario;
  if (st.phase === PHASE.LOBBY) return '<p class="muted center" style="margin-top:2rem">Newsy pojawią się po starcie pierwszej tury.</p>';
  const c = clock();
  const month = st.phase === PHASE.OPEN ? c.month : null;
  const content = turnContent(s, st.turn, month);
  let html = '';
  if (st.phase === PHASE.FINISHED) {
    const last = s.turns[s.turns.length - 1];
    if (last.summary) html += `<section class="card summary"><span class="badge">Podsumowanie: ${escapeHtml(last.label)}</span><p>${text(last.summary)}</p></section>`;
  }
  if (content.previousSummary) {
    html += `<section class="card summary" style="margin-top:.75rem"><span class="badge">Podsumowanie: ${escapeHtml(content.previousLabel)}</span><p>${text(content.previousSummary)}</p></section>`;
  }
  for (const m of [...content.monthEvents].reverse()) {
    html += `<section class="card event" style="margin-top:.75rem"><span class="badge accent">${escapeHtml(m.name || `Miesiąc ${m.month}`)}</span><h3 style="margin-top:.5rem">${escapeHtml(m.event.title)}</h3><p>${text(m.event.body)}</p></section>`;
  }
  html += `<h2 style="margin-top:1rem">Newsy: ${escapeHtml(content.turnData?.label || '')}</h2>`;
  const news = content.turnData?.news || [];
  if (!news.length) html += '<p class="muted">Brak newsów w tym kwartale.</p>';
  for (const n of news) {
    const tag = n.asset ? getAsset(s, n.asset)?.name : n.scope === 'global' ? 'Ogólne' : n.scope === 'biwak' ? 'Biwak' : '';
    html += `<section class="card news" style="margin-top:.6rem">${tag ? `<span class="badge">${escapeHtml(tag)}</span>` : ''}
      <h3 style="margin-top:.4rem">${escapeHtml(n.title)}</h3><p>${text(n.body)}</p>${n.why ? `<div class="why">${text(n.why)}</div>` : ''}</section>`;
  }
  return html;
}

function viewZagadki() {
  const s = ctx.scenario;
  const t = me();
  const puzzles = s.puzzles || [];
  if (!puzzles.length) return '<p class="muted center">W tej grze nie ma zagadek.</p>';
  const solvedCount = puzzles.filter((p) => t.solved[p.id]).length;
  let html = `<p class="muted">Rozwiązane: ${solvedCount}/${puzzles.length}. Każda zagadka daje dotację raz na zespół. Wielkość liter, polskie znaki i spacje nie mają znaczenia.</p>`;
  for (const p of puzzles) {
    const reward = p.reward ?? s.config.puzzleReward;
    const solved = t.solved[p.id];
    html += `<form class="card stack" style="margin-top:.6rem" data-puzzle="${escapeHtml(p.id)}">
      <div class="row between"><h3>${escapeHtml(p.title)}</h3><span class="badge ${solved ? 'ok' : 'accent'}">${solved ? '✔ rozwiązana' : `+${escapeHtml(formatMoney(Math.round(reward * 100)))}`}</span></div>
      ${p.hint ? `<p class="muted">${text(p.hint)}</p>` : ''}
      ${solved ? '' : `<div class="row"><input class="grow" style="width:auto" data-keep="pz-${escapeHtml(p.id)}" name="answer" placeholder="Hasło" autocomplete="off" autocapitalize="off" spellcheck="false" required>
        <button class="primary" type="submit">Sprawdź</button></div>`}
    </form>`;
  }
  return html;
}

function viewDziennik() {
  const s = ctx.scenario;
  const t = me();
  const entries = [...t.log].reverse();
  if (!entries.length) return '<p class="muted center" style="margin-top:2rem">Dziennik jest pusty.</p>';
  let html = '<section class="card"><h2>Dziennik zespołu</h2>';
  for (const e of entries) {
    const a = e.asset ? getAsset(s, e.asset) : null;
    let what = '';
    let amount = e.amount;
    if (e.kind === 'trade') {
      what = `${e.side === 'buy' ? 'Kupno' : 'Sprzedaż'}: ${a?.name ?? e.asset}${a && isUnitAsset(a) ? ` · ${formatInt(e.qty)} szt.${e.price != null ? ` × ${formatMoney(e.price)}` : ''}` : ''}`;
      if (amount != null && e.side === 'buy') amount = -amount;
    } else if (e.kind === 'puzzle') what = `Zagadka: ${s.puzzles.find((p) => p.id === e.puzzle)?.title ?? e.puzzle}`;
    else if (e.kind === 'adjustment') what = `Korekta prowadzącego${e.note ? `: ${e.note}` : ''}`;
    else if (e.kind === 'inflation') what = `Inflacja na gotówce (${formatPercent(e.rate, { sign: true })})`;
    else if (e.kind === 'interest') what = `Odsetki: ${a?.name ?? ''} (${formatPercent(e.rate, { sign: true })})`;
    html += `<div class="log-item ${e.ok ? '' : 'rejected'}"><div class="what">${escapeHtml(what)}
      <div class="muted small">${e.at ? escapeHtml(formatTime(e.at)) : ''}${e.turn ? ` · tura ${e.turn}` : ''}${e.ok ? '' : ` · <span class="err">odrzucona: ${escapeHtml(e.error || '')}</span>`}</div></div>
      <div class="num ${e.ok ? signedClass(amount) : 'muted'}">${amount != null ? escapeHtml(formatMoney(amount, { sign: true })) : ''}</div></div>`;
  }
  return html + '</section>';
}

function viewPomoc() {
  const s = ctx.scenario;
  const c = s.config;
  let html = '<section class="card"><h2>Zasady</h2>';
  for (const r of s.rules) html += `<h3 style="margin-top:.8rem">${escapeHtml(r.title)}</h3><p>${text(r.body)}</p>`;
  html += `<h3 style="margin-top:.8rem">Liczby w tej grze</h3><ul class="small">
    <li>Kapitał startowy: ${escapeHtml(formatMoney(Math.round(c.startCapital * 100)))}</li>
    <li>Liczba tur (kwartałów): ${c.turns}, każda po ${c.monthsPerTurn} miesiące zegarowe</li>
    <li>Limit pozycji: maks. ${Math.round(c.positionLimit * 100)}% wartości portfela w jednym aktywie (nie dotyczy gotówki)</li>
    <li>Dotacja za zagadkę: ${escapeHtml(formatMoney(Math.round(c.puzzleReward * 100)))} (raz na zespół)</li></ul></section>`;
  html += '<section class="card" style="margin-top:.75rem"><h2>Słowniczek</h2>';
  for (const g of s.glossary) html += `<p><b>${escapeHtml(g.term)}</b> — ${text(g.definition)}</p>`;
  html += '</section>';
  html += `<p class="muted small center" style="margin-top:1rem">${escapeHtml(s.meta.title)}${s.meta.version ? ` · scenariusz ${escapeHtml(String(s.meta.version))}` : ''}</p>`;
  return html;
}

// ------------------------------------------------------------------ akcje

function onMainClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'breakdown') {
    openDialog('Skąd się wzięło moje saldo?', breakdownHtml(ctx.scenario, me(), ctx.state.priceIndex));
    return;
  }
  if (act === 'logout') { logout(); return; }
  const assetBtn = e.target.closest('[data-asset]');
  if (assetBtn) openTrade(assetBtn.dataset.asset);
}

async function onMainSubmit(e) {
  const form = e.target.closest('form[data-puzzle]');
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.puzzle;
  const input = form.querySelector('input[name=answer]');
  const btn = form.querySelector('button');
  const normalized = normalizeAnswer(input.value);
  if (!normalized) { toast('Wpisz hasło.', 'bad'); return; }
  btn.disabled = true;
  try {
    const res = await ctx.store.teamPuzzle(session.teamId, session.code, id, normalized);
    if (res === 'ok') { toast('✔ Dobre hasło! Dotacja dopisana do gotówki.', 'ok'); input.value = ''; }
    else if (res === 'already') toast('Ta zagadka jest już rozwiązana przez Wasz zespół.');
    else toast('✖ To nie jest właściwe hasło.', 'bad');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ okno transakcji

function openTrade(assetId) {
  const s = ctx.scenario;
  const a = getAsset(s, assetId);
  if (!a) return;
  const unit = isUnitAsset(a);
  let side = 'buy';
  let mode = 'amount';
  const d = openDialog(a.name, `
    ${a.description ? `<p class="muted">${text(a.description)}</p>` : ''}
    <div class="preview" id="tinfo"></div>
    <div class="seg" id="tside"><button type="button" data-side="buy" class="on buy">Kup</button><button type="button" data-side="sell">Sprzedaj</button></div>
    ${unit ? '<div class="seg" id="tmode" style="margin-top:.5rem"><button type="button" data-mode="amount" class="on">Za kwotę (zł)</button><button type="button" data-mode="qty">Ilość (szt.)</button></div>' : ''}
    <label for="tval" id="tlabel">Kwota (zł)</label>
    <input id="tval" inputmode="decimal" autocomplete="off" placeholder="0">
    <div class="qbtns"><button type="button" data-q="0.25">25%</button><button type="button" data-q="0.5">50%</button><button type="button" data-q="1">Max</button><button type="button" data-q="0">Wyczyść</button></div>
    <div class="preview" id="tprev"></div>
    <button class="primary block" id="tgo">Kup</button>`, { onClose: () => { tradeDlg = null; } });
  const body = d.body;
  const input = $('#tval', body);

  const parseValue = () => {
    const raw = input.value.trim();
    if (!raw) return 0;
    if (unit && mode === 'qty') { const q = Number(raw.replace(/\s/g, '')); return Number.isInteger(q) ? q : NaN; }
    return parseMoneyInput(raw);
  };

  const update = () => {
    const st = ctx.state;
    const t = me();
    if (!t) { d.close(); return; }
    const idx = st.priceIndex;
    const held = t.holdings[a.id] || 0;
    const ch = priceChange(a, idx);
    $('#tinfo', body).innerHTML = `
      ${unit ? `<div class="line"><span>Kurs</span><span>${money(priceOf(a, idx))} ${changeHtml(ch)}</span></div>`
    : `<div class="line"><span>Oprocentowanie</span><span class="num up">${escapeHtml(formatPercent(rateOf(a, st.phase === PHASE.OPEN ? st.turn : st.turn + 1), { sign: true }))} / kwartał</span></div>`}
      <div class="line"><span>Masz</span><span>${escapeHtml(qtyLabel(a, held))}${unit && held ? ` = ${escapeHtml(formatMoney(valueOf(a, held, idx)))}` : ''}</span></div>
      <div class="line"><span>Gotówka</span><span>${money(t.cash)}</span></div>`;
    for (const b of body.querySelectorAll('#tside button')) b.className = b.dataset.side === side ? `on ${side}` : '';
    for (const b of body.querySelectorAll('#tmode button')) b.classList.toggle('on', b.dataset.mode === mode);
    $('#tlabel', body).textContent = unit && mode === 'qty' ? 'Ilość (szt.)' : 'Kwota (zł)';
    input.setAttribute('inputmode', unit && mode === 'qty' ? 'numeric' : 'decimal');
    const go = $('#tgo', body);
    go.textContent = side === 'buy' ? 'Kup' : 'Sprzedaj';
    go.className = `block ${side}`;
    const prev = $('#tprev', body);
    if (!tradingOpen()) {
      prev.innerHTML = `<span class="err">${st.phase === PHASE.OPEN ? 'Czas tury minął — handel zablokowany.' : 'Handel jest teraz zamknięty.'}</span>`;
      go.disabled = true;
      return;
    }
    const v = parseValue();
    if (!v || Number.isNaN(v)) {
      prev.innerHTML = `<span class="muted">${Number.isNaN(v) ? 'Nieprawidłowa wartość.' : 'Wpisz kwotę lub ilość albo użyj przycisków.'}</span>`;
      go.disabled = true;
      return;
    }
    const q = quoteTrade(s, t, { asset: a.id, side, mode: unit ? mode : 'amount', value: v }, tradeCtx(st));
    let html = '';
    if (q.qty > 0) {
      html += unit
        ? `<div class="line"><span>${formatInt(q.qty)} szt. × ${escapeHtml(formatMoney(q.price))}</span><b class="num">${escapeHtml(formatMoney(q.amount))}</b></div>`
        : `<div class="line"><span>Kwota</span><b class="num">${escapeHtml(formatMoney(q.amount))}</b></div>`;
      html += `<div class="line muted"><span>Gotówka po transakcji</span><span class="num">${escapeHtml(formatMoney(q.cashAfter))}</span></div>`;
    }
    if (!q.ok) html += `<div class="err">${escapeHtml(q.error)}${q.maxBuy != null ? ` Możesz dokupić jeszcze za ${escapeHtml(formatMoney(q.maxBuy))}.` : ''}</div>`;
    prev.innerHTML = html;
    go.disabled = !q.ok;
    go.dataset.qty = q.qty;
  };

  body.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-side]');
    if (sb) { side = sb.dataset.side; update(); return; }
    const mb = e.target.closest('[data-mode]');
    if (mb) {
      const st = ctx.state;
      const price = priceOf(a, st.priceIndex);
      const v = parseValue();
      if (mb.dataset.mode !== mode && v > 0 && price > 0) {
        input.value = mb.dataset.mode === 'qty' ? String(Math.floor(v / price)) : (v * price / 100).toFixed(2).replace('.', ',');
      }
      mode = mb.dataset.mode;
      update();
      return;
    }
    const qb = e.target.closest('[data-q]');
    if (qb) {
      const f = Number(qb.dataset.q);
      const st = ctx.state;
      const t = me();
      if (!f) { input.value = ''; update(); return; }
      const price = priceOf(a, st.priceIndex);
      const held = t.holdings[a.id] || 0;
      if (unit) {
        const maxQty = side === 'buy'
          ? Math.floor(maxBuyAmount(s, t, a.id, tradeCtx(st)) / price)
          : held;
        const q = Math.floor(maxQty * f);
        input.value = mode === 'qty' ? String(q) : (q * price / 100).toFixed(2).replace('.', ',');
      } else {
        const max = side === 'buy' ? maxBuyAmount(s, t, a.id, tradeCtx(st)) : held;
        input.value = (Math.floor(max * f) / 100).toFixed(2).replace('.', ',');
      }
      update();
      return;
    }
    if (e.target.closest('#tgo')) submit();
  });
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  async function submit() {
    const go = $('#tgo', body);
    if (go.disabled) return;
    const qty = Number(go.dataset.qty);
    go.disabled = true;
    const label = `${side === 'buy' ? 'Kupno' : 'Sprzedaż'}: ${a.name}${unit ? ` (${formatInt(qty)} szt.)` : ` (${formatMoney(qty)})`}`;
    try {
      const id = await ctx.store.teamTrade(session.teamId, session.code, { asset: a.id, side, qty });
      pending.set(Number(id), label);
      toast(`Wysłano: ${label}`);
      d.close();
      onUpdate(ctx); // jeśli wynik już jest (tryb lokalny)
    } catch (err) {
      toast(err.message, 'bad');
      go.disabled = false;
    }
  }

  tradeDlg = { update };
  update();
  setTimeout(() => input.focus(), 50);
}
