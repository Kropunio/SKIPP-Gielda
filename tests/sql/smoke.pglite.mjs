// Uruchamia supabase/tests/smoke.sql na pglite. Użycie: npm i --no-save @electric-sql/pglite && node tests/sql/smoke.pglite.mjs
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
const R=new URL('../../supabase/', import.meta.url);
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon nologin; create role authenticated nologin; create schema extensions; create publication supabase_realtime;`);
await db.exec(readFileSync(new URL('migrations/001_init.sql', R),'utf8'));
await db.exec(readFileSync(new URL('migrations/002_hide_future_and_lockout.sql', R),'utf8'));
const sql=readFileSync(new URL('tests/smoke.sql', R),'utf8').replace(/^.set .*$/gm,'');
let res; try { res=await db.exec(sql); } catch(e){ console.log('ERR', e.message, 'pos', e.position); console.log(sql.slice(Math.max(0,Number(e.position)-80), Number(e.position)+40)); process.exit(1);}
for (const r of res) if (r.rows.length) console.log(JSON.stringify(r.rows[0]).slice(0,120));
