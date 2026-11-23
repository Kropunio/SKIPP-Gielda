// Liczy hash hasła zagadki do pola "answerHashes" w scenariuszu (żeby hasło nie było jawne w JSON-ie).
// Użycie: node tools/hash-answer.mjs "Tajne hasło" ["inne hasło" ...]
import { normalizeAnswer, hashAnswer } from '../js/engine.js';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Użycie: node tools/hash-answer.mjs "hasło" ["hasło2" ...]');
  process.exit(1);
}
for (const a of args) console.log(`${hashAnswer(a)}  ← "${a}" (po normalizacji: "${normalizeAnswer(a)}")`);
