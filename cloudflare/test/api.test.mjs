// End-to-end check of the Worker against `wrangler dev` (local D1 + the built public/ files).
// Run: npx wrangler dev --port 8787 --local   then   node --test test/   (BASE=... to point elsewhere)
// Needs the local test user `oldbcrypt` (bcrypt hash of spike-test-password); see the command in README-cloudflare.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

function client() {
  let cookie = '';
  return async (path, body, method) => {
    const res = await fetch(BASE + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
  };
}
const user = 'u' + crypto.randomBytes(4).toString('hex');
const password = crypto.randomBytes(9).toString('hex');
const call = client();

test('static: root redirects to the app, data files are served', async () => {
  assert.match(await (await fetch(BASE + '/')).text(), /url=\/app\//);
  assert.equal((await fetch(BASE + '/app/')).status, 200);
  const dictFile = await (await fetch(BASE + '/data/pump/words.json')).json();
  assert.ok(dictFile.length > 10000);
});

test('register, login (cookie + token), status, logout', async () => {
  assert.equal((await call('/api/auth/register', { username: user, email: `${user}@example.test`, password })).data.success, true);
  assert.equal((await call('/api/auth/register', { username: user, password })).status, 400, 'duplicate username');
  assert.equal((await call('/api/auth/login', { username: user, password: 'wrong-password' })).status, 401);
  const login = await call('/api/auth/login', { username: user, password });
  assert.equal(login.data.success, true);
  assert.match(login.headers.get('set-cookie'), /zm_sid=[a-f0-9]{64}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax/);
  assert.match(login.data.token, /^[a-f0-9]{64}$/);
  assert.equal((await call('/api/auth/status')).data.loggedIn, true);
  const bearer = await fetch(BASE + '/api/auth/status', { headers: { authorization: `Bearer ${login.data.token}` } });
  assert.equal((await bearer.json()).username, user, 'mobile app token works');
  const other = client();
  assert.equal((await other('/api/progress')).status, 401, 'no login, no data');
});

test('old bcrypt passwords still work and are upgraded on login', async () => {
  const c = client();
  assert.equal((await c('/api/auth/login', { username: 'oldbcrypt', password: 'spike-test-password' })).data.success, true);
  assert.equal((await c('/api/auth/login', { username: 'oldbcrypt', password: 'spike-test-password' })).data.success, true, 'second login uses the new hash');
});

test('progress round trip; known words from YouTube merge in', async () => {
  const progress = { characterProgress: { 我: { known: true } }, compoundProgress: { 中: { known: ['中国'], total: 1, quizScores: {} } } };
  assert.equal((await call('/api/progress', progress)).data.success, true);
  await call('/api/pp/words', { word: '的士', status: 'known' }); // a compound listed under 的
  await call('/api/pp/words', { word: '好', status: 'known' });
  const got = (await call('/api/progress')).data;
  assert.equal(got.characterProgress['我'].known, true);
  assert.deepEqual(got.compoundProgress['中'].known, ['中国']);
  assert.ok(got.compoundProgress['的'].known.includes('的士'), 'YouTube-known compound shows under its character');
  assert.equal(got.characterProgress['好'].known, true);
});

test('un-marking syncs both ways between YouTube and the app', async () => {
  let got = (await call('/api/progress')).data;
  got.characterProgress['他'] = { known: true };
  got.compoundProgress['中'].known.push('中心');
  await call('/api/progress', got);
  // Un-marked on YouTube: un-ticked in the app.
  await call('/api/pp/words', { word: '中心', status: 'ignored' });
  await call('/api/pp/words', { word: '他', status: 'learning' });
  got = (await call('/api/progress')).data;
  assert.ok(!got.compoundProgress['中'].known.includes('中心'));
  assert.equal(got.characterProgress['他'].known, false);
  await call('/api/progress', got); // the app saves what it got
  // Ticked again in the app: known on YouTube too.
  got.characterProgress['他'].known = true;
  await call('/api/progress', got);
  assert.equal((await call('/api/pp/words')).data.words['他'].status, 'known');
  // Un-ticked in the app: no longer known on YouTube, and stays un-ticked.
  got.characterProgress['他'].known = false;
  await call('/api/progress', got);
  assert.equal((await call('/api/pp/words')).data.words['他'], undefined);
  assert.equal((await call('/api/progress')).data.characterProgress['他'].known, false);
});

test('extension word statuses', async () => {
  await call('/api/pp/words', { word: '螺丝', status: 'learning' });
  await call('/api/pp/words', { word: '汤姆', status: 'ignored' });
  assert.equal((await call('/api/pp/words', { word: '中文', status: 'bogus' })).status, 400);
  assert.equal((await call('/api/pp/words', { word: 'abc', status: 'known' })).status, 400);
  const words = (await call('/api/pp/words')).data.words;
  assert.equal(words['螺丝'].status, 'learning');
  assert.equal(words['汤姆'].status, 'ignored');
  assert.equal(words['我'].status, 'known', 'known from app progress');
  assert.equal(words['中国'].status, 'known');
});

test('hover look-ups from the dictionary files', async () => {
  const one = (await call('/api/pp/lookup?word=' + encodeURIComponent('从'))).data;
  assert.equal(one.pinyin, 'cóng');
  assert.match(one.meaning, /^from/);
  assert.match((await call('/api/pp/lookup?word=' + encodeURIComponent('很好'))).data.meaning, /很 .* · 好 /);
  const batch = (await call('/api/pp/lookup-batch', { words: ['东西', '螺丝', 'abc'] })).data.words;
  assert.match(batch['东西'].meaning, /^thing/);
  assert.equal(batch['螺丝'].meaning, 'screw');
});

test('Daily Sentences: learning word first, 3 sentences in a row, new words after', async () => {
  const r = (await call('/api/pump/next?limit=20')).data;
  assert.equal(r.goal, 60);
  assert.deepEqual(r.cards.slice(0, 3).map((c) => c.target), ['螺丝', '螺丝', '螺丝'], 'YouTube learning word comes first');
  assert.equal(r.cards[0].kind, 'review');
  assert.ok(r.cards.some((c) => c.kind === 'new'));
  assert.ok(!r.cards.some((c) => c.target === '我' || c.target === '汤姆'), 'known/ignored never targets');
  assert.equal(new Set(r.cards.map((c) => c.id)).size, r.cards.length, 'no repeated sentence');
  const card = r.cards[0];
  assert.ok(card.tokens.find((t) => t.w === '螺丝').m, 'tokens carry meanings');
  for (const c of r.cards.slice(0, 3)) assert.equal((await call('/api/pump/answer', { sentenceId: c.id, target: c.target, kind: c.kind, words: {} })).status, 200);
  const newCard = r.cards.find((c) => c.kind === 'new');
  const a = (await call('/api/pump/answer', { sentenceId: newCard.id, target: newCard.target, kind: 'new', words: { [newCard.target]: 'known' } })).data;
  assert.equal(a.done, 4);
  assert.equal(a.newToday, 1);
  const again = (await call('/api/pump/next?limit=20')).data;
  assert.ok(!again.cards.some((c) => c.target === '螺丝' && c.kind === 'review'), 'done for today after 3');
  assert.ok(!again.cards.some((c) => c.target === newCard.target), 'word marked known is gone');
  assert.equal((await call('/api/pump/answer', { sentenceId: 'x', target: '螺丝' })).status, 400);
});

test('sentences, custom words, word edits', async () => {
  const forChar = (await call('/api/sentences/' + encodeURIComponent('的'))).data;
  assert.equal(forChar.senses[0].sentences.length, 15);
  const added = (await call('/api/sentences', { chinese: '我喜欢茶。', pinyin: 'wǒ xǐhuan chá', english: 'I like tea.' })).data;
  assert.equal((await call('/api/sentences')).data.sentences[0].chinese, '我喜欢茶。');
  assert.equal((await call(`/api/sentences/${added.sentence.id}`, null, 'DELETE')).data.success, true);
  assert.equal((await call('/api/sentences')).data.sentences.length, 0);

  const cw = (await call('/api/custom-words', { word: '的哥哥', meanings: ['test'] })).data;
  assert.equal(cw.baseChar, '的,哥', 'base characters from ZhongMap list');
  assert.equal((await call('/api/custom-words', { word: '的哥哥', meanings: ['test'] })).status, 400, 'duplicate');
  const list = (await call('/api/custom-words')).data.words;
  assert.equal(list[0].pinyin, 'de gē ge');
  assert.equal((await call(`/api/custom-words/${list[0].id}`, null, 'DELETE')).data.success, true);

  assert.equal((await call('/api/word-edits', { word: '的', wordType: 'character', meanings: ['of'] })).data.success, true);
  assert.deepEqual((await call('/api/word-edits/' + encodeURIComponent('的') + '/character')).data.edit.meanings, ['of']);
});

test('save phrase from YouTube', async () => {
  assert.equal((await call('/api/pp/phrases', { zh: '我想知道明天是否会下雨。', en: 'I wonder if it will rain tomorrow.' })).status, 201);
  assert.equal((await call('/api/pp/phrases', { zh: '我想知道明天是否会下雨。' })).data.created, false);
  const s = (await call('/api/sentences')).data.sentences[0];
  assert.equal(s.pinyin, 'wǒ xiǎng zhī dào míng tiān shì fǒu huì xià yǔ。');
});

test('CORS: only the extension gets credentialed cross-origin access', async () => {
  const ext = await fetch(BASE + '/api/health', { headers: { origin: 'chrome-extension://abcdef' } });
  assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdef');
  const evil = await fetch(BASE + '/api/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('logout ends the session', async () => {
  await call('/api/auth/logout', {});
  assert.equal((await call('/api/auth/status')).data.loggedIn, false);
});
