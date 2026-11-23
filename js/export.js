// Eksport CSV pod polskiego Excela: separator ';', przecinek dziesiętny, UTF-8 z BOM, CRLF.
import { csvMoney } from './format.js';
import { tradableAssets, getAsset, isUnitAsset, valueOf, portfolioTotal, PHASE, priceIndexFor, totalTurns } from './engine.js';

export const BOM = '﻿';

export function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows) {
  return BOM + rows.map((r) => r.map(csvField).join(';')).join('\r\n') + '\r\n';
}

const PHASE_LABEL = { lobby: 'przed grą', open: 'tura otwarta', closed: 'po zamknięciu tury', finished: 'koniec gry' };

function iso(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Stan portfeli po każdej turze (+ stan bieżący, jeśli tura jest otwarta). */
export function portfoliosCsv(scenario, st) {
  const assets = tradableAssets(scenario);
  const header = ['Tura', 'Moment', 'Zespół', 'Gotówka'];
  for (const a of assets) {
    if (isUnitAsset(a)) header.push(`${a.name} [szt.]`, `${a.name} [kurs]`, `${a.name} [wartość]`);
    else header.push(`${a.name} [wartość]`);
  }
  header.push('Wartość portfela', 'Miejsce');
  const rows = [header];
  const snaps = [...st.history];
  if (st.phase === PHASE.OPEN) {
    const idx = priceIndexFor(st.phase, st.turn, totalTurns(scenario));
    const teams = {};
    for (const [id, t] of st.teams) teams[id] = { cash: t.cash, holdings: { ...t.holdings }, total: portfolioTotal(scenario, t, idx) };
    snaps.push({ turn: st.turn, phase: st.phase, priceIndex: idx, at: Date.now(), teams, current: true });
  }
  for (const s of snaps) {
    const entries = Object.entries(s.teams).map(([id, t]) => ({ id, ...t, name: st.teams.get(id)?.name ?? id }));
    entries.sort((a, b) => b.total - a.total);
    entries.forEach((e, i) => { e.rank = i > 0 && entries[i - 1].total === e.total ? entries[i - 1].rank : i + 1; });
    const moment = s.current ? 'stan bieżący (tura otwarta)' : s.turn === 0 ? 'start gry' : `po turze ${s.turn}${s.phase === PHASE.FINISHED ? ' (koniec gry)' : ''}`;
    for (const e of entries) {
      const row = [s.turn, moment, e.name, csvMoney(e.cash)];
      for (const a of assets) {
        const qty = e.holdings[a.id] || 0;
        if (isUnitAsset(a)) row.push(qty, csvMoney(Math.round(a.prices[s.priceIndex] * 100)), csvMoney(valueOf(a, qty, s.priceIndex)));
        else row.push(csvMoney(qty));
      }
      row.push(csvMoney(e.total), e.rank);
      rows.push(row);
    }
  }
  return toCsv(rows);
}

/** Wszystkie operacje zespołów: transakcje (także odrzucone), zagadki, korekty, inflacja, odsetki. */
export function transactionsCsv(scenario, st) {
  const header = ['Lp', 'Czas', 'Tura', 'Zespół', 'Rodzaj', 'Aktywo', 'Kierunek', 'Ilość', 'Kurs', 'Kwota', 'Gotówka po', 'Status', 'Uwagi'];
  const rows = [header];
  let lp = 0;
  const entries = [];
  for (const t of st.teams.values()) for (const e of t.log) entries.push({ ...e, teamName: t.name });
  entries.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || Number(a.eventId ?? 0) - Number(b.eventId ?? 0));
  for (const e of entries) {
    const a = e.asset ? getAsset(scenario, e.asset) : null;
    const unit = a && isUnitAsset(a);
    const kind = { trade: 'transakcja', puzzle: 'zagadka', adjustment: 'korekta prowadzącego', inflation: 'inflacja', interest: 'odsetki' }[e.kind];
    let note = e.error || '';
    if (e.kind === 'puzzle') note = (scenario.puzzles.find((p) => p.id === e.puzzle)?.title) || e.puzzle;
    if (e.kind === 'adjustment') note = e.note || '';
    if ((e.kind === 'inflation' || e.kind === 'interest') && e.rate != null) note = `stopa ${String((e.rate * 100).toFixed(2)).replace('.', ',')}%`;
    const signed = e.kind === 'trade' ? (e.amount == null ? '' : csvMoney(e.side === 'buy' ? -e.amount : e.amount)) : csvMoney(e.amount);
    rows.push([
      ++lp,
      iso(e.at),
      e.turn ?? '',
      e.teamName,
      kind,
      a ? a.name : '',
      e.kind === 'trade' ? (e.side === 'buy' ? 'kupno' : 'sprzedaż') : '',
      e.kind === 'trade' ? (unit ? e.qty : '') : '',
      e.kind === 'trade' && unit && e.price != null ? csvMoney(e.price) : '',
      signed,
      e.kind === 'trade' && e.ok ? csvMoney(e.cashAfter) : '',
      e.ok ? 'OK' : 'odrzucona',
      note,
    ]);
  }
  return toCsv(rows);
}

export { PHASE_LABEL };
