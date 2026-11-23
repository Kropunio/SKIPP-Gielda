// Polskie formatowanie liczb i kwot. Kwoty w całej aplikacji trzymamy w groszach (liczby całkowite).

export const NBSP = ' ';

function groupThousands(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 123456 → "1 234,56 zł" (spacja nierozdzielająca). opts: { sign, unit, noUnit, decimals } */
export function formatMoney(grosze, opts = {}) {
  const g = Math.round(Number(grosze) || 0);
  const neg = g < 0;
  const abs = Math.abs(g);
  const zl = Math.floor(abs / 100);
  const gr = abs % 100;
  let s = groupThousands(String(zl));
  if (opts.decimals !== 0) s += ',' + String(gr).padStart(2, '0');
  const sign = neg ? '-' : opts.sign && g > 0 ? '+' : '';
  const unit = opts.noUnit ? '' : NBSP + (opts.unit || 'zł');
  return sign + s + unit;
}

/** Liczba całkowita z grupowaniem tysięcy: 12345 → "12 345". */
export function formatInt(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + groupThousands(String(Math.abs(v)));
}

/** 0.015 → "1,5%"; opts.sign dodaje "+". */
export function formatPercent(fraction, opts = {}) {
  const decimals = opts.decimals ?? 1;
  const v = Number(fraction) * 100;
  const fixed = Math.abs(v).toFixed(decimals).replace('.', ',');
  const isZero = Number(Math.abs(v).toFixed(decimals)) === 0;
  const sign = v < 0 && !isZero ? '-' : opts.sign && v > 0 && !isZero ? '+' : '';
  return sign + fixed + '%';
}

/** Kwota w groszach do CSV dla polskiego Excela: "1234,56" (bez grupowania, przecinek dziesiętny). */
export function csvMoney(grosze) {
  const g = Math.round(Number(grosze) || 0);
  const neg = g < 0;
  const abs = Math.abs(g);
  return (neg ? '-' : '') + Math.floor(abs / 100) + ',' + String(abs % 100).padStart(2, '0');
}

/** Parsowanie kwoty wpisanej przez użytkownika ("1 234,5" / "1234.50") → grosze lub NaN. */
export function parseMoneyInput(str) {
  const s = String(str ?? '').replace(/[\s zł]/gi, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

/** Czas w ms → "m:ss". */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
