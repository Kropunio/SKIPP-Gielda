// Ekran projektora (16:9): tura/kwartał, zegar tury i miesiąca, event miesiąca, newsy, kursy, wykres, ranking (gdy odsłonięty).
import { boot } from './app.js';
import { PHASE, turnClock, turnContent, ranking, wealthSeries, isUnitAsset, priceOf, priceChange, rateOf, getAsset, startCapital } from './engine.js';
import { escapeHtml, formatMoney, formatClock, formatPercent } from './format.js';
import { $, text, chartSvg, wealthChartSvg, rankingHtml, changeHtml, PHASE_LABEL, IDLE_CLOCK } from './ui.js';

const root = document.getElementById('root');
const NEWS_MS = 12000;
let ctx = null;
let slide = 0;
let slideAt = Date.now();
let lastMonth = null;
let lastKey = '';

boot({ onUpdate: (c) => { ctx = c; render(); } }).then((c) => {
  ctx = c;
  render();
  setInterval(tick, 250);
}).catch((e) => console.error(e));

const clock = () => turnClock(ctx.state.turnStartedAt, ctx.state.turnDuration, ctx.store.now(), ctx.scenario.config.monthsPerTurn);

function slides() {
  const s = ctx.scenario;
  const st = ctx.state;
  if (st.phase === PHASE.LOBBY) return [];
  const out = [];
  if (st.phase === PHASE.FINISHED) {
    const last = s.turns[s.turns.length - 1];
    if (last.summary) out.push({ tag: `Podsumowanie: ${last.label}`, title: '', body: last.summary });
    return out;
  }
  const c = turnContent(s, st.turn);
  if (c.previousSummary) out.push({ tag: `Podsumowanie: ${c.previousLabel}`, title: '', body: c.previousSummary });
  for (const n of c.turnData?.news || []) {
    const tag = n.asset ? getAsset(s, n.asset)?.name : n.scope === 'global' ? 'Ogólne' : n.scope === 'biwak' ? 'Biwak' : 'News';
    out.push({ tag, title: n.title, body: n.body, why: n.why });
  }
  return out;
}

function render() {
  if (!ctx) return;
  const s = ctx.scenario;
  const st = ctx.state;
  const g = ctx.game;
  const turns = s.config.turns;
  const td = st.turn ? s.turns[st.turn - 1] : null;
  const c = clock();
  lastMonth = c.month;
  const key = `${st.phase}|${st.turn}`;
  let fresh = false;
  if (key !== lastKey) { slide = 0; slideAt = Date.now(); lastKey = key; fresh = true; }

  const sub = st.phase === PHASE.LOBBY ? `Start: ${formatMoney(startCapital(s))} na zespół · ${turns} kwartałów`
    : st.phase === PHASE.FINISHED ? 'Koniec gry' : `${td?.label ?? ''} · tura ${st.turn}/${turns} · ${PHASE_LABEL[st.phase]}`;

  const top = `<div class="s-top">
    <div><div class="s-title">${escapeHtml(s.meta.title)}</div><div class="s-sub">${escapeHtml(sub)}</div></div>
    <div class="s-clocks">
      <div class="s-clock" id="mclock"><div class="lbl" id="mlbl">Miesiąc</div><div class="mid" id="mval"></div></div>
      <div class="s-clock" id="tclock"><div class="lbl">Do końca tury</div><div class="big" id="tval"></div></div>
    </div></div>`;

  // lewa kolumna: event miesiąca + newsy
  let event = '';
  if (st.phase === PHASE.OPEN && td) {
    const m = td.months[c.month - 1];
    if (m?.event) event = `<div class="s-card s-event"><h2>${escapeHtml(m.name || `Miesiąc ${c.month}`)}</h2><div class="t">${escapeHtml(m.event.title)}</div><p>${text(m.event.body)}</p></div>`;
  }
  let left;
  if (st.phase === PHASE.LOBBY) {
    left = `<div class="s-left"><div></div><div class="s-card"><div class="s-center"><div class="huge">Zaraz zaczynamy</div><p class="muted">Zaloguj się na telefonie: nazwa zespołu + kod</p></div></div></div>`;
  } else {
    left = `<div class="s-left">${event || '<div></div>'}<div class="s-card s-news" id="news"></div></div>`;
  }

  // prawa kolumna: kursy + wykres / ranking
  const idx = st.priceIndex;
  const rows = s.assets.filter((a) => a.type !== 'cash').map((a) => {
    if (isUnitAsset(a)) {
      return `<div class="p ${a.type === 'index' ? 'idx' : ''}"><span class="n">${escapeHtml(a.name)}</span><span class="v">${escapeHtml(formatMoney(priceOf(a, idx)))}</span><span class="c">${changeHtml(priceChange(a, idx))}</span></div>`;
    }
    const rt = st.phase === PHASE.OPEN || st.phase === PHASE.FINISHED ? Math.max(1, st.turn) : Math.min(st.turn + 1, turns);
    return `<div class="p"><span class="n">${escapeHtml(a.name)}</span><span class="v up">${escapeHtml(formatPercent(rateOf(a, rt), { sign: true }))}</span><span class="c muted">/ kwartał</span></div>`;
  }).join('');
  const cashA = s.assets.find((a) => a.type === 'cash');
  const cashRt = st.phase === PHASE.OPEN || st.phase === PHASE.FINISHED ? Math.max(1, st.turn) : Math.min(st.turn + 1, turns);
  const cashRow = `<div class="p"><span class="n">${escapeHtml(cashA.name)}</span><span class="v down">${escapeHtml(formatPercent(rateOf(cashA, cashRt), { sign: true }))}</span><span class="c muted">/ kwartał</span></div>`;
  const prices = `<div class="s-card"><h2>Kursy ${st.phase === PHASE.CLOSED ? '(nowe — po zamknięciu tury)' : ''}</h2><div class="s-prices" style="grid-template-columns:repeat(${s.assets.length > 18 ? 3 : 2}, 1fr)">${cashRow}${rows}</div></div>`;
  let bottom;
  if (g?.rankingVisible) {
    // ranking + historia wartości portfeli wszystkich zespołów (po odsłonięciu)
    bottom = `<div class="s-bottom2"><div class="s-card s-ranking"><h2>Ranking</h2>${rankingHtml(ranking(s, st))}</div>` +
      `<div class="s-card s-chart"><h2>Wartość portfeli po turach (zł)</h2><div style="height:calc(100% - 3.5vh)">${wealthChartSvg(wealthSeries(s, st), { width: 760, height: 400, endLabels: 'name', startZl: startCapital(s) / 100 })}</div></div></div>`;
  } else {
    bottom = `<div class="s-card s-chart"><h2>Kursy względem startu (start = 100)</h2><div style="height:calc(100% - 3.5vh)">${chartSvg(s, idx, { width: 1200, height: 340 })}</div></div>`;
  }
  root.innerHTML = `${top}<div class="s-body">${left}<div class="s-right">${prices}${bottom}</div></div>`;
  renderNews(true, fresh);
  tick();
}

function renderNews(force = false, animate = true) {
  const box = $('#news');
  if (!box) return;
  const list = slides();
  if (!list.length) { box.innerHTML = '<h2>Newsy</h2><p class="muted">Brak newsów.</p>'; return; }
  if (Date.now() - slideAt > NEWS_MS) { slide = (slide + 1) % list.length; slideAt = Date.now(); force = true; }
  if (!force) return;
  const n = list[slide % list.length];
  box.innerHTML = `<h2>Newsy</h2><div class="slide${animate ? ' anim' : ''}"><span class="tag">${escapeHtml(n.tag || '')}</span>
    ${n.title ? `<div class="t">${escapeHtml(n.title)}</div>` : '<div style="height:1vh"></div>'}<p>${text(n.body)}</p>${n.why ? `<div class="why">${text(n.why)}</div>` : ''}</div>
    <div class="dots">${list.map((_, i) => `<span class="${i === slide % list.length ? 'on' : ''}"></span>`).join('')}</div>`;
}

function tick() {
  if (!ctx || !$('#tval')) return;
  const st = ctx.state;
  const c = clock();
  if (st.phase === PHASE.OPEN && c.running) {
    if (c.month !== lastMonth) { render(); return; }
    $('#tval').textContent = formatClock(c.remaining);
    $('#tclock').classList.toggle('expired', c.expired);
    const td = ctx.scenario.turns[st.turn - 1];
    $('#mlbl').textContent = `${td?.months[c.month - 1]?.name || 'Miesiąc'} · ${c.month}/${ctx.scenario.config.monthsPerTurn}`;
    $('#mval').textContent = c.expired ? 'koniec' : formatClock(c.monthRemaining);
  } else {
    $('#tval').textContent = IDLE_CLOCK[st.phase] || '';
    $('#mlbl').textContent = PHASE_LABEL[st.phase] || '';
    $('#mval').textContent = '';
  }
  renderNews();
}
