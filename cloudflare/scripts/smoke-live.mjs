// Live smoke test of the deployed Worker with a throwaway account, removed afterwards.
// Touches only that account's rows (no shared data like word edits). Usage: node scripts/smoke-live.mjs [base-url]
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'https://zhongmap.seanmichaelbateman.workers.dev';
const ACCOUNT = '1b9fb5c24b6a5ef05a42e51ed84235bc';
const DATABASE = 'f33ff05f-31c8-4684-b931-5262d46348a6';
let cookie = '';
async function call(path, body) {
  const t = Date.now();
  const res = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => null);
  console.log(`${String(res.status).padEnd(4)} ${String(Date.now() - t).padStart(5)} ms  ${path}`);
  return { status: res.status, data };
}
async function d1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }),
  });
  return (await res.json()).result?.[0]?.results;
}

const username = 'smoke_' + crypto.randomBytes(3).toString('hex');
const password = crypto.randomBytes(9).toString('hex');
try {
  assert.equal((await call('/api/auth/register', { username, password })).data.success, true);
  assert.equal((await call('/api/auth/login', { username, password })).data.success, true);
  assert.equal((await call('/api/auth/status')).data.loggedIn, true);
  assert.equal((await call('/api/progress', { characterProgress: { 我: { known: true } }, compoundProgress: {} })).data.success, true);
  assert.equal((await call('/api/progress')).data.characterProgress['我'].known, true);
  assert.equal((await call('/api/pp/words', { word: '螺丝', status: 'learning' })).status, 200);
  assert.equal((await call('/api/pp/words')).data.words['螺丝'].status, 'learning');
  assert.match((await call('/api/pp/lookup?word=' + encodeURIComponent('从'))).data.meaning, /^from/);
  const next = (await call('/api/pump/next?limit=10')).data;
  assert.equal(next.cards[0].target, '螺丝');
  assert.equal((await call('/api/pump/answer', { sentenceId: next.cards[0].id, target: '螺丝', kind: 'review', words: {} })).status, 200);
  assert.equal((await call('/api/sentences/' + encodeURIComponent('的'))).data.senses[0].sentences.length, 15);
  const tr = (await call('/api/pp/translate-batch', { texts: ['I like tea', 'See you tomorrow'], to: 'zh-CN' })).data.texts;
  console.log('     translate from Cloudflare:', JSON.stringify(tr));
  assert.equal((await fetch(BASE + '/data/dict/0.json')).status, 200);
  console.log('ALL OK');
} finally {
  const [u] = (await d1('SELECT id FROM users WHERE username = ?', [username])) || [];
  if (u) {
    for (const t of ['sessions', 'progress', 'pp_words', 'pump_days', 'pump_seen', 'custom_words', 'user_sentences']) await d1(`DELETE FROM ${t} WHERE user_id = ?`, [u.id]);
    await d1('DELETE FROM users WHERE id = ?', [u.id]);
    console.log('test account removed');
  }
}
