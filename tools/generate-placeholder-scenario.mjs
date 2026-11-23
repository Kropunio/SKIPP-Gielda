// Generuje placeholderowy data/scenario.json (losowe kursy, teksty "TODO").
// Użycie: node tools/generate-placeholder-scenario.mjs [ścieżka]
// UWAGA: nadpisuje plik — nie uruchamiaj po wpisaniu prawdziwego scenariusza.
import { writeFileSync } from 'node:fs';
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const T = 6;
const walk = (start, lo, hi) => { const p=[start]; for (let i=0;i<T;i++){ const ch = lo + rnd()*(hi-lo); p.push(Math.max(1, Math.round(p[i]*(1+ch)*100)/100)); } return p; };
const letters = 'ABCDEFGHIJKLMNOPQRSTUVW'.split('');
const stocks = letters.map((L,i)=>({
  id: `d${String(i+1).padStart(2,'0')}`,
  type: 'stock',
  name: `Drużyna ${L}`,
  ticker: `DR${L}`,
  group: i < 18 ? 'TODO: grupa 1 (np. DSH Trop)' : 'TODO: grupa 2 (fikcyjne)',
  description: `TODO: krótki opis drużyny ${L}.`,
  prices: walk(Math.round((20 + rnd()*80))*1, -0.25, 0.3)
}));
const scenario = {
  meta: { title: 'Giełda Hufca', subtitle: 'TODO: podtytuł gry', version: 'placeholder-1', currency: 'zł' },
  config: { turns: T, turnSeconds: 600, testTurnSeconds: 30, monthsPerTurn: 3, startCapital: 10000, positionLimit: 0.4, positionLimitExemptTypes: ['cash'], puzzleReward: 500, rankingPlannedTurns: [3, 5] },
  assets: [
    { id: 'cash', type: 'cash', name: 'Śledzie do namiotu', ticker: 'ŚLEDZ', description: 'TODO: opis gotówki (inflacja zjada jej wartość).', rates: Array(T).fill(-0.015) },
    { id: 'bond', type: 'bond', name: 'Obligacje Komendy', ticker: 'OBL', description: 'TODO: opis obligacji.', rates: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02] },
    { id: 'idx', type: 'index', name: 'Indeks CHORĄGIEW', ticker: 'CHOR', description: 'TODO: opis indeksu (ETF).', prices: walk(100, -0.08, 0.12) },
    ...stocks,
    { id: 'pewniak', type: 'special', name: 'Fundusz Pewniak', ticker: 'PEWN', description: 'TODO: opis funduszu Pewniak.', prices: [10, 10, 10, 12, 0, 0, 0], buyTurns: [3], sellTurns: [], offer: { title: 'TODO: Oferta specjalna — Fundusz Pewniak', body: 'TODO: treść oferty (gwarantowany zysk!...).' } }
  ],
  turns: Array.from({ length: T }, (_, i) => ({
    turn: i + 1,
    label: `Kwartał ${i + 1}`,
    news: [1, 2, 3].map(n => ({
      title: `TODO: News ${n} tury ${i + 1}`,
      body: 'TODO: 2–3 zdania treści newsa.',
      why: 'TODO: jedno zdanie „z czego wynika”.',
      ...(n === 1 ? { scope: 'global' } : n === 2 ? { asset: stocks[(i * 3) % stocks.length].id } : { scope: 'biwak' })
    })),
    summary: `TODO: podsumowanie kwartału ${i + 1} (pokazywane na starcie kolejnej tury).`,
    months: [1, 2, 3].map(m => ({ name: `Miesiąc ${m}`, event: (m === 2 ? { title: `TODO: event miesiąca (tura ${i + 1})`, body: 'TODO: opis eventu, np. BIWAK albo wybory komendanta.' } : null) }))
  })),
  puzzles: [
    { id: 'z1', title: 'Zagadka 1', hint: 'TODO: treść/wskazówka karty 1', answers: ['hasło jeden'], reward: 500 },
    { id: 'z2', title: 'Zagadka 2', hint: 'TODO: treść/wskazówka karty 2', answers: ['hasło dwa', 'haslo 2'] },
    { id: 'z3', title: 'Zagadka 3', hint: 'TODO: treść/wskazówka karty 3', answers: ['hasło trzy'] },
    { id: 'z4', title: 'Zagadka 4', hint: 'TODO: treść/wskazówka karty 4 (hasło zapisane jako hash SHA-256; przykładowe hasło: „Tajne hasło”)', answerHashes: ['c616a565468c30bb8542b4cf2c041f2a3a38e2978846593a3264526c9f5f787c'] }
  ],
  rules: [
    { title: 'Cel gry', body: 'TODO: cel gry.' },
    { title: 'Przebieg tury', body: 'TODO: jak wygląda tura (kwartał), zegar miesięcy, newsy.' },
    { title: 'Handel', body: 'TODO: kupno/sprzedaż po cenie bieżącej tury, limit pozycji.' },
    { title: 'Zagadki', body: 'TODO: jak działają zagadki i dotacje.' }
  ],
  glossary: ['Akcja', 'Obligacja', 'Indeks / ETF', 'Inflacja', 'Stopa procentowa', 'Dywersyfikacja', 'Portfel'].map(term => ({ term, definition: 'TODO: definicja.' }))
};
writeFileSync(process.argv[2] || 'data/scenario.json', JSON.stringify(scenario, null, 2).replace(/\[\s+([-0-9.,\s]+?)\s+\]/g, (m, inner) => '[' + inner.split(/,\s*/).join(', ') + ']') + '\n');
