// Copies user data from the NAS's SQLite file into the Cloudflare D1 database, replacing what's there.
// Re-runnable: run once to test, again at cutover (stop using the NAS app/extension first, or later changes are missed).
// Usage: node scripts/migrate-nas-to-d1.mjs <path to chinese-app.db>   (needs CLOUDFLARE_API_TOKEN)
// Rows go through D1's HTTP API with bound parameters: the ~600 KB progress blob is far over the 100 KB SQL statement limit.
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { bucketOf, COMPOUND_BUCKETS } from '../src/buckets.js';

const ACCOUNT = '1b9fb5c24b6a5ef05a42e51ed84235bc';
const DATABASE = 'f33ff05f-31c8-4684-b931-5262d46348a6';
const token = process.env.CLOUDFLARE_API_TOKEN;
const dbPath = process.argv[2];
if (!dbPath || !token) throw new Error('usage: CLOUDFLARE_API_TOKEN=... node scripts/migrate-nas-to-d1.mjs <chinese-app.db>');

async function d1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`${sql.slice(0, 80)}: ${JSON.stringify(body.errors)}`);
  return body.result[0].results;
}

const SQL = await initSqlJs();
const nas = new SQL.Database(fs.readFileSync(dbPath));
const rows = (sql) => {
  const r = nas.exec(sql);
  return r.length ? r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : [];
};

// Multi-row INSERTs, kept under D1's 100 bound parameters per query.
async function copy(table, columns, data) {
  await d1(`DELETE FROM ${table}`);
  const per = Math.max(1, Math.floor(100 / columns.length));
  for (let i = 0; i < data.length; i += per) {
    const chunk = data.slice(i, i + per);
    const values = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    await d1(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`, chunk.flatMap((r) => columns.map((c) => r[c] ?? null)));
  }
  const [{ n }] = await d1(`SELECT COUNT(*) AS n FROM ${table}`);
  if (n !== data.length) throw new Error(`${table}: copied ${n} of ${data.length}`);
  console.log(`${table.padEnd(15)} ${n}`);
}

// Known words in the app's progress JSON (same rule as the Worker's knownFromProgress).
function knownFromProgress(progress) {
  const known = new Set();
  for (const entry of Object.values(progress.compoundProgress || {})) for (const w of entry?.known || []) known.add(w);
  for (const [c, entry] of Object.entries(progress.characterProgress || {})) if (entry?.known) known.add(c);
  return [...known];
}

const compoundsDir = path.join(import.meta.dirname, '..', 'public', 'data', 'compounds');
const compoundChars = (word) => JSON.parse(fs.readFileSync(path.join(compoundsDir, `${bucketOf(word, COMPOUND_BUCKETS)}.json`), 'utf8'))[word] || [];

await d1('DELETE FROM sessions'); // everyone logs in again on the new address
await copy('users', ['id', 'username', 'password_hash', 'email', 'created_at', 'last_login', 'is_admin', 'is_blocked', 'can_edit_definitions', 'can_upload_images'],
  rows('SELECT * FROM users'));
await copy('progress', ['user_id', 'data', 'known_json', 'updated_at'],
  rows('SELECT * FROM progress').map((r) => ({ ...r, known_json: JSON.stringify(knownFromProgress(JSON.parse(r.data))) })));
await copy('custom_words', ['id', 'user_id', 'word', 'pinyin', 'meanings', 'base_char', 'created_at'], rows('SELECT * FROM custom_words'));
await copy('word_edits', ['id', 'word', 'word_type', 'edited_meanings', 'edited_by', 'created_at', 'updated_at'], rows('SELECT * FROM word_edits'));
await copy('user_sentences', ['id', 'user_id', 'chinese', 'pinyin', 'english', 'created_at'], rows('SELECT * FROM user_sentences'));
await copy('quiz_history', ['id', 'user_id', 'word', 'word_type', 'quiz_mode', 'quality', 'is_correct', 'interval_before', 'interval_after',
  'easiness_before', 'easiness_after', 'score_before', 'score_after', 'session_id', 'created_at'], rows('SELECT * FROM quiz_history'));
await copy('pp_words', ['user_id', 'word', 'known', 'updated_at', 'status', 'due', 'reps', 'shown_day', 'chars'],
  rows('SELECT * FROM pp_words').map((r) => ({ ...r, status: r.status || (r.known ? 'known' : 'unknown'), chars: JSON.stringify(compoundChars(r.word)) })));
await copy('pump_days', ['user_id', 'day', 'done', 'new_words'], rows('SELECT * FROM pump_days'));
await copy('pump_seen', ['user_id', 'sentence_id', 'at'], rows('SELECT * FROM pump_seen'));

// The copy must hold exactly the NAS's progress, byte for byte.
const [copied] = await d1('SELECT data FROM progress WHERE user_id = 1');
const [original] = rows('SELECT data FROM progress WHERE user_id = 1');
if (original && copied?.data !== original.data) throw new Error('progress for user 1 differs after copy');
console.log('done: progress identical');
