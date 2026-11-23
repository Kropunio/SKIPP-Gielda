// Wspólne elementy UI (bez logiki gry): toasty, okna dialogowe, tabele, wykres SVG, rozpiska salda.
import { escapeHtml, formatMoney, formatPercent, formatInt } from './format.js';
import { isUnitAsset, priceOf, priceChange, balanceBreakdown, tradableAssets } from './engine.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tekst ze scenariusza → bezpieczny HTML z zachowaniem nowych linii. */
export const text = (s) => escapeHtml(s).replace(/\n/g, '<br>');

export const PHASE_LABEL = {
  lobby: 'Przed startem',
  open: 'Handel otwarty',
  closed: 'Tura zamknięta',
  finished: 'Koniec gry',
};

/** Tekst zegara poza otwartą turą. */
export const IDLE_CLOCK = { lobby: 'START', closed: 'PAUZA', finished: 'KONIEC' };

export function money(g, opts) { return `<span class="num">${escapeHtml(formatMoney(g, opts))}</span>`; }
export function signedClass(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
export function changeHtml(ch) {
  if (!ch || ch.change == null) return '<span class="muted">—</span>';
  const arrow = ch.change > 0 ? '▲' : ch.change < 0 ? '▼' : '■';
  return `<span class="num ${signedClass(ch.change)}">${arrow} ${escapeHtml(formatPercent(ch.change, { sign: true }))}</span>`;
}

// ---------------------------------------------------------------- toasty

export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
}

// ---------------------------------------------------------------- dialogi

/** Otwiera <dialog>; zwraca { el, body, close, setTitle }. */
export function openDialog(title, bodyHtml = '', { onClose } = {}) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="dlg-head"><h2 class="dlg-title">${escapeHtml(title)}</h2><button class="x ghost" aria-label="Zamknij">✕</button></div><div class="dlg-body">${bodyHtml}</div>`;
  document.body.appendChild(dlg);
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.querySelector('.x').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.showModal();
  return { el: dlg, body: dlg.querySelector('.dlg-body'), close, setTitle: (t) => { dlg.querySelector('.dlg-title').textContent = t; } };
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const d = openDialog(title, `<p>${text(message)}</p><div class="row" style="justify-content:flex-end;margin-top:1rem">
      <button class="ghost" data-a="no">Anuluj</button><button class="${danger ? 'danger' : 'primary'}" data-a="yes">${escapeHtml(okLabel)}</button></div>`,
    { onClose: () => { if (!answered) resolve(false); } });
    d.body.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      answered = true;
      resolve(a === 'yes');
      d.close();
    });
  });
}

/** Zachowuje wartości i fokus pól [data-keep] przy ponownym renderowaniu kontenera. */
export function rerender(container, html) {
  const kept = {};
  let focusKey = null;
  let sel = null;
  for (const el of container.querySelectorAll('[data-keep]')) {
    kept[el.dataset.keep] = el.value;
    if (el === document.activeElement) { focusKey = el.dataset.keep; sel = [el.selectionStart, el.selectionEnd]; }
  }
  container.innerHTML = html;
  for (const el of container.querySelectorAll('[data-keep]')) {
    if (kept[el.dataset.keep] != null) el.value = kept[el.dataset.keep];
    if (el.dataset.keep === focusKey) { el.focus(); try { el.setSelectionRange(...sel); } catch { /* np. type=number */ } }
  }
}

// ---------------------------------------------------------------- rozpiska salda

export function breakdownHtml(scenario, team, idx) {
  const b = balanceBreakdown(scenario, team, idx);
  const cash = scenario.assets.find((a) => a.type === 'cash');
  const neutral = (cls) => cls.includes('total') || cls.includes('start');
  const row = (label, amount, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num right ${neutral(cls) ? '' : signedClass(amount)}">${escapeHtml(formatMoney(amount, { sign: !cls.includes('total') && !cls.includes('start') }))}</td></tr>`;
  let html = '<table class="breakdown"><tbody>';
  html += row('Kapitał startowy', b.start, 'start');
  html += row(`Inflacja na gotówce (${escapeHtml(cash.name)})`, b.inflation);
  if (b.interest || scenario.assets.some((a) => a.type === 'bond')) html += row('Odsetki z obligacji', b.interest);
  for (const a of b.assets) {
    if (a.type === 'bond' && a.pl === 0) continue;
    const detail = isUnitAsset(scenario.assets.find((x) => x.id === a.id))
      ? `${formatInt(a.qty)} szt. · wartość ${formatMoney(a.value)}` : `wartość ${formatMoney(a.value)}`;
    html += row(`Zysk/strata: ${escapeHtml(a.name)}<div class="muted small">${escapeHtml(detail)}</div>`, a.pl);
  }
  html += row('Dotacje za zagadki', b.puzzles);
  html += row('Korekty prowadzącego', b.adjustments);
  for (const adj of b.adjustmentsList) {
    html += `<tr class="sub"><td>${escapeHtml(adj.note || 'bez opisu')}</td><td class="num right">${escapeHtml(formatMoney(adj.amount, { sign: true }))}</td></tr>`;
  }
  html += row('Razem = wartość portfela', b.total, 'total');
  html += '</tbody></table>';
  if (!b.consistent) html += `<p class="err">Uwaga: suma rozpiski (${escapeHtml(formatMoney(b.sum))}) różni się od wartości portfela — zgłoś prowadzącemu.</p>`;
  return html;
}

// ---------------------------------------------------------------- ranking

export function rankingHtml(rows, meId = null) {
  if (!rows.length) return '<p class="muted">Brak zespołów.</p>';
  return `<table><thead><tr><th>#</th><th>Zespół</th><th class="num">Wartość portfela</th></tr></thead><tbody>${rows
    .map((r) => `<tr class="${r.teamId === meId ? 'me' : ''}"><td>${r.rank}</td><td>${escapeHtml(r.name)}</td><td class="num">${escapeHtml(formatMoney(r.total))}</td></tr>`)
    .join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- tabela kursów

export function priceRows(scenario, idx) {
  return tradableAssets(scenario).map((a) => ({
    asset: a,
    price: isUnitAsset(a) ? priceOf(a, idx) : null,
    change: priceChange(a, idx),
  }));
}

// ---------------------------------------------------------------- wykres SVG

const PALETTE = ['#3fb6a8', '#ff8a65', '#9575cd', '#4fc3f7', '#aed581', '#f06292', '#ffd54f', '#7986cb', '#4db6ac', '#e57373', '#ba68c8', '#81c784'];

/**
 * Wykres wartości aktywów (kurs znormalizowany: start = 100) od indeksu 0 do upTo.
 * Indeks wyróżniony grubą linią; etykiety dla indeksu i skrajnych aktywów.
 */
export function chartSvg(scenario, upTo, { width = 960, height = 360, labelsX } = {}) {
  const series = scenario.assets.filter((a) => a.type === 'index' || a.type === 'stock');
  const n = scenario.config.turns + 1;
  const last = Math.max(0, Math.min(upTo, n - 1));
  const padL = 46, padR = 150, padT = 16, padB = 34;
  const W = width - padL - padR, H = height - padT - padB;
  const norm = (a, i) => (a.prices[0] > 0 ? (a.prices[i] / a.prices[0]) * 100 : 100);
  let min = 100, max = 100;
  for (const a of series) for (let i = 0; i <= last; i++) { const v = norm(a, i); min = Math.min(min, v); max = Math.max(max, v); }
  const span = Math.max(10, max - min);
  min = Math.floor((min - span * 0.08) / 5) * 5;
  max = Math.ceil((max + span * 0.08) / 5) * 5;
  const x = (i) => padL + (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v) => padT + H - ((v - min) / (max - min)) * H;
  const labels = labelsX || Array.from({ length: n }, (_, i) => (i < n - 1 ? `T${i + 1}` : 'Koniec'));

  let s = `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Wykres kursów aktywów">`;
  // siatka
  const step = (max - min) / 4;
  for (let k = 0; k <= 4; k++) {
    const v = min + step * k;
    s += `<line x1="${padL}" x2="${padL + W}" y1="${y(v)}" y2="${y(v)}" stroke="#2e3e4f" stroke-width="1"/>`;
    s += `<text x="${padL - 6}" y="${y(v) + 4}" fill="#8fa3b5" font-size="12" text-anchor="end">${Math.round(v)}</text>`;
  }
  s += `<line x1="${padL}" x2="${padL + W}" y1="${y(100)}" y2="${y(100)}" stroke="#8fa3b5" stroke-dasharray="4 4" stroke-width="1"/>`;
  labels.forEach((l, i) => { s += `<text x="${x(i)}" y="${height - 10}" fill="${i <= last ? '#e8eef4' : '#4a5b6b'}" font-size="13" text-anchor="middle">${escapeHtml(l)}</text>`; });

  if (last === 0) {
    s += `<text x="${padL + W / 2}" y="${padT + H / 2}" fill="#8fa3b5" font-size="16" text-anchor="middle">Wykres pojawi się po pierwszej turze</text></svg>`;
    return s;
  }
  const finals = series.map((a) => ({ a, v: norm(a, last) })).sort((p, q) => q.v - p.v);
  const labelled = new Set([finals[0]?.a.id, finals[1]?.a.id, finals[finals.length - 1]?.a.id, finals[finals.length - 2]?.a.id]);
  const ordered = [...series.filter((a) => a.type !== 'index'), ...series.filter((a) => a.type === 'index')];
  const labelsOut = [];
  ordered.forEach((a, k) => {
    const isIdx = a.type === 'index';
    const color = isIdx ? '#f2b134' : PALETTE[k % PALETTE.length];
    const pts = Array.from({ length: last + 1 }, (_, i) => `${x(i).toFixed(1)},${y(norm(a, i)).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${isIdx ? 5 : 2}" stroke-opacity="${isIdx ? 1 : 0.55}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (isIdx || labelled.has(a.id)) labelsOut.push({ a, color, isIdx, y: y(norm(a, last)) });
  });
  // rozsunięcie etykiet, żeby się nie nakładały
  labelsOut.sort((p, q) => p.y - q.y);
  for (let i = 1; i < labelsOut.length; i++) if (labelsOut[i].y - labelsOut[i - 1].y < 16) labelsOut[i].y = labelsOut[i - 1].y + 16;
  for (const l of labelsOut) {
    const name = l.a.ticker || l.a.name;
    s += `<text x="${x(last) + 8}" y="${l.y + 4}" fill="${l.color}" font-size="${l.isIdx ? 15 : 13}" font-weight="${l.isIdx ? 800 : 600}">${escapeHtml(name)} ${Math.round(norm(l.a, last))}</text>`;
  }
  s += '</svg>';
  return s;
}

/** Krótki opis ilości: "12 szt." albo kwota dla obligacji. */
export function qtyLabel(asset, qty) {
  return isUnitAsset(asset) ? `${formatInt(qty)} szt.` : formatMoney(qty);
}
