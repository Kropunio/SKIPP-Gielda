// Walidacja pliku scenariusza z linii poleceń:  node tools/check-scenario.mjs ścieżka/do/scenariusza.json
import { readFileSync } from 'node:fs';
import { validateScenario } from '../js/scenario.js';

const file = process.argv[2] || 'data/scenario.json';
let json;
try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`Nie można wczytać ${file}: ${e.message}`); process.exit(2); }
const v = validateScenario(json);
for (const w of v.warnings) console.warn('Ostrzeżenie:', w);
if (!v.ok) { for (const e of v.errors) console.error('BŁĄD:', e); process.exit(1); }
console.log(`OK: „${json.meta.title}” — ${json.config.turns} tur, ${json.assets.length} aktywów, ${json.puzzles.length} zagadek.`);
