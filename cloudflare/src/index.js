// ZhongMap API on Cloudflare Workers + D1 (replaces the NAS's server-synology.js).
// Free plan: 10 ms CPU per request, so big read-only data (dictionary, sentences) is pre-split into small
// static files under public/data (see scripts/build-cloudflare-data.mjs) and only the needed files are read.
import bcrypt from 'bcryptjs';
import { pinyin } from 'pinyin-pro';
import { bucketOf, DICT_BUCKETS, PUMP_BUCKETS, CHAR_BUCKETS, COMPOUND_BUCKETS } from './buckets.js';

const DAY_MS = 86400000;
const SESSION_MS = 30 * DAY_MS;
const PUMP_GOAL = 60;
const PUMP_NEW_PER_DAY = 10;
const PUMP_PER_WORD = 3; // like Language Reactor: a few sentences in a row per word you don't know
const STATUSES = ['known', 'learning', 'ignored', 'unknown'];
const HAN = /[㐀-鿿]/;
const PBKDF2_ITERATIONS = 100000;

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, body) { super(body.error || body.message); this.status = status; this.body = body; }
}
const fail = (status, error, extra = {}) => { throw new HttpError(status, { success: false, error, message: error, ...extra }); };
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const isKnownish = (s) => s === 'known' || s === 'ignored';
const today = () => new Date().toISOString().slice(0, 10); // shortcut: UTC day, same as the NAS; add a user timezone if it matters
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Small per-isolate cache of parsed data files; a warm Worker skips re-reading them.
const dataCache = new Map();
async function dataFile(env, path) {
  if (dataCache.has(path)) return dataCache.get(path);
  const res = await env.ASSETS.fetch(new Request(`https://assets/data/${path}`));
  const value = res.ok ? await res.json() : {};
  if (dataCache.size > 60) dataCache.delete(dataCache.keys().next().value);
  dataCache.set(path, value);
  return value;
}
const dictEntry = async (env, word) => (await dataFile(env, `dict/${bucketOf(word, DICT_BUCKETS)}.json`))[word];
const pumpCandidates = async (env, word) => (await dataFile(env, `pump/${bucketOf(word, PUMP_BUCKETS)}.json`))[word] || [];

// ---------- passwords and sessions ----------

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}
// Accounts copied from the NAS still have bcrypt hashes (~100 ms CPU to check); they're re-hashed on login.
async function checkPassword(password, stored) {
  if (stored.startsWith('pbkdf2$')) {
    const [, iterations, salt, hash] = stored.split('$');
    const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iterations)));
    const want = unb64(hash);
    return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
  }
  return bcrypt.compareSync(password, stored);
}

async function currentUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const cookie = request.headers.get('cookie') || '';
  const sid = auth.startsWith('Bearer ') ? auth.slice(7) : (cookie.match(/(?:^|;\s*)zm_sid=([a-f0-9]{64})/) || [])[1];
  if (!sid) return null;
  return env.DB.prepare(`SELECT u.id, u.username, u.email, u.is_admin, u.is_blocked, u.can_edit_definitions
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid = ? AND s.expires > ?`).bind(sid, Date.now()).first();
}
async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user || user.is_blocked) fail(401, 'Not authenticated', { message: 'Please log in to continue' });
  return user;
}
const sessionCookie = (sid, maxAge) => `zm_sid=${sid}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

// ---------- word status ----------

// Known words (from the app's progress) overridden by explicit marks (extension / Daily Sentences).
async function userWords(env, userId) {
  const status = new Map();
  const srs = new Map();
  const progress = await env.DB.prepare('SELECT known_json FROM progress WHERE user_id = ?').bind(userId).first();
  for (const w of JSON.parse(progress?.known_json || '[]')) status.set(w, 'known');
  const { results } = await env.DB.prepare('SELECT word, status, due, reps, shown_day FROM pp_words WHERE user_id = ?').bind(userId).all();
  for (const r of results) {
    status.set(r.word, r.status || 'unknown');
    srs.set(r.word, { due: r.due, reps: r.reps, shownDay: r.shown_day });
  }
  return { status, srs };
}

// Known words inside the app's progress blob: compoundProgress[char].known lists + characterProgress[char].known.
function knownFromProgress(progress) {
  const known = new Set();
  for (const entry of Object.values(progress.compoundProgress || {})) for (const w of entry?.known || []) known.add(w);
  for (const [c, entry] of Object.entries(progress.characterProgress || {})) if (entry?.known) known.add(c);
  return [...known];
}

async function saveWord(env, userId, word, status, card = {}) {
  const chars = (await dataFile(env, `compounds/${bucketOf(word, COMPOUND_BUCKETS)}.json`))[word] || [];
  return env.DB.prepare(`INSERT OR REPLACE INTO pp_words (user_id, word, known, updated_at, status, due, reps, shown_day, chars)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(userId, word, isKnownish(status) ? 1 : 0, Date.now(), status,
    card.due ?? null, card.reps ?? null, card.shownDay ?? null, JSON.stringify(chars)).run();
}

// ---------- translation (Google's plain endpoint; YouTube's own translation is the main source) ----------

const translateCache = new Map();
async function googleTranslate(text, to) {
  const key = `${to}:${text}`;
  if (translateCache.has(key)) return translateCache.get(key);
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=${encodeURIComponent(to)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(text),
  });
  if (!res.ok) throw new Error(`Google translate HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const out = ((await res.json())[0] || []).map((s) => s[0] || '').join('');
  if (translateCache.size > 2000) translateCache.delete(translateCache.keys().next().value);
  translateCache.set(key, out);
  return out;
}
// Many lines per call (joined by newlines, split back); a chunk whose line count changes stays untranslated.
async function translateMany(texts, to) {
  const out = texts.map(() => '');
  for (let i = 0; i < texts.length; i += 50) {
    const ids = texts.map((t, k) => k).slice(i, i + 50).filter((k) => texts[k]);
    if (!ids.length) continue;
    try {
      const parts = (await googleTranslate(ids.map((k) => texts[k]).join('\n'), to)).split('\n');
      if (parts.length === ids.length) ids.forEach((k, j) => { out[k] = parts[j].trim(); });
    } catch (error) {
      console.error('translate batch', error.message);
    }
  }
  return out;
}

// Meaning for hover bubbles: dictionary, else the word's longest dictionary pieces ("很 very · 好 good").
async function meaningOf(env, word) {
  const entry = await dictEntry(env, word);
  if (entry) return entry[1];
  const chars = [...word];
  const pieces = [];
  for (let i = 0; i < chars.length;) {
    let j = chars.length;
    let found = null;
    for (; j > i; j--) if ((found = await dictEntry(env, chars.slice(i, j).join('')))) break;
    if (found) pieces.push(`${chars.slice(i, j).join('')} ${found[1].split(';')[0].trim()}`);
    i = Math.max(j, i + 1);
  }
  return pieces.length > 1 ? pieces.join(' · ') : (pieces[0] || '').replace(/^\S+ /, '');
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

route('GET', '/api/health', () => json({ status: 'ok' }));

route('POST', '/api/auth/register', async ({ env, body }) => {
  const { username, password, email } = body;
  if (!username || !password) fail(400, 'Username and password are required');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) fail(400, 'Username must be 3-20 characters (letters, numbers, underscore only)');
  if (String(password).length < 6) fail(400, 'Password must be at least 6 characters');
  if (await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()) fail(400, 'Username already exists');
  await env.DB.prepare('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)')
    .bind(username, await hashPassword(String(password)), email || null).run();
  return json({ success: true, username, message: 'Registration successful' });
});

route('POST', '/api/auth/login', async ({ env, body }) => {
  const { username, password } = body;
  if (!username || !password) fail(400, 'Username and password are required');
  const user = await env.DB.prepare('SELECT id, username, password_hash, is_admin, is_blocked FROM users WHERE username = ?').bind(username).first();
  if (!user || !(await checkPassword(String(password), user.password_hash))) fail(401, 'Invalid username or password');
  if (user.is_blocked) fail(403, 'Account blocked', { message: 'Your account has been blocked by an administrator' });
  const sid = hex(crypto.getRandomValues(new Uint8Array(32)));
  const writes = [
    env.DB.prepare('INSERT INTO sessions (sid, user_id, expires) VALUES (?, ?, ?)').bind(sid, user.id, Date.now() + SESSION_MS),
    env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now()),
  ];
  if (!user.password_hash.startsWith('pbkdf2$')) {
    writes.push(env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(String(password)), user.id));
  }
  await env.DB.batch(writes);
  return json({ success: true, username: user.username, isAdmin: user.is_admin === 1, token: sid, message: 'Login successful' },
    200, { 'set-cookie': sessionCookie(sid, SESSION_MS / 1000) });
});

route('POST', '/api/auth/logout', async ({ request, env }) => {
  const sid = ((request.headers.get('cookie') || '').match(/(?:^|;\s*)zm_sid=([a-f0-9]{64})/) || [])[1]
    || (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE sid = ?').bind(sid).run();
  return json({ success: true, message: 'Logged out successfully' }, 200, { 'set-cookie': sessionCookie('', 0) });
});

route('GET', '/api/auth/status', async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return json({ loggedIn: false });
  if (user.is_blocked) return json({ loggedIn: false, error: 'Account blocked' });
  return json({ loggedIn: true, username: user.username, email: user.email, isAdmin: user.is_admin === 1 });
});

route('GET', '/api/progress', async ({ request, env }) => {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT data FROM progress WHERE user_id = ?').bind(user.id).first();
  // shortcut: parses the ~600 KB blob (~15 ms CPU, over the free 10 ms but tolerated as the app calls it rarely); split it into rows if Cloudflare starts refusing.
  const progress = row ? JSON.parse(row.data) : { compoundProgress: {} };
  progress.characterProgress = progress.characterProgress || {};
  progress.compoundProgress = progress.compoundProgress || {};
  // Words marked known on YouTube / in Daily Sentences show in ZhongMap; the app saves them on its next sync.
  const { results } = await env.DB.prepare("SELECT word, chars FROM pp_words WHERE user_id = ? AND status = 'known'").bind(user.id).all();
  for (const { word, chars } of results) {
    if ([...word].length === 1) {
      progress.characterProgress[word] = { ...progress.characterProgress[word], known: true };
      continue;
    }
    for (const c of JSON.parse(chars || '[]')) {
      const entry = (progress.compoundProgress[c] = progress.compoundProgress[c] || { known: [], total: 0, quizScores: {} });
      entry.known = entry.known || [];
      if (!entry.known.includes(word)) entry.known.push(word);
    }
  }
  return json(progress);
});

route('POST', '/api/progress', async ({ request, env, body }) => {
  const user = await requireUser(request, env);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid progress data');
  const data = JSON.stringify(body);
  if (data.length > 1900000) fail(413, 'Progress data too large'); // D1 row limit is 2 MB
  await env.DB.prepare(`INSERT INTO progress (user_id, data, known_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, known_json = excluded.known_json, updated_at = CURRENT_TIMESTAMP`)
    .bind(user.id, data, JSON.stringify(knownFromProgress(body))).run();
  return json({ success: true, message: 'Progress saved to database' });
});

route('GET', '/api/custom-words', async ({ request, env }) => {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare('SELECT * FROM custom_words WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
  return json({ success: true, words: results.map((r) => ({ id: r.id, word: r.word, pinyin: r.pinyin, meanings: JSON.parse(r.meanings), baseChar: r.base_char, createdAt: r.created_at })) });
});

route('POST', '/api/custom-words', async ({ request, env, body }) => {
  const user = await requireUser(request, env);
  const { word, meanings } = body;
  if (!word || !Array.isArray(meanings) || !meanings.length) fail(400, 'Word and meanings are required');
  let baseChar = body.baseChar;
  if (!baseChar) {
    // Characters of the word that are in ZhongMap's character list, else its first character.
    const listed = [];
    for (const c of new Set(word)) if ((await dataFile(env, `chars/${bucketOf(c, CHAR_BUCKETS)}.json`))[c]) listed.push(c);
    baseChar = (listed.length ? listed : [[...word][0]]).join(',');
  }
  const py = body.pinyin && String(body.pinyin).trim() ? body.pinyin : pinyin(word, { toneType: 'symbol', separator: ' ' });
  try {
    await env.DB.prepare('INSERT INTO custom_words (user_id, word, pinyin, meanings, base_char) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, word, py, JSON.stringify(meanings), baseChar).run();
  } catch (error) {
    if (/UNIQUE/.test(error.message)) fail(400, 'This word already exists in your custom words');
    throw error;
  }
  return json({ success: true, message: 'Custom word added', baseChar });
});

route('DELETE', '/api/custom-words/(\\d+)', async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  await env.DB.prepare('DELETE FROM custom_words WHERE id = ? AND user_id = ?').bind(Number(params[0]), user.id).run();
  return json({ success: true, message: 'Custom word deleted' });
});

route('GET', '/api/sentences', async ({ request, env }) => {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare('SELECT id, chinese, pinyin, english, created_at FROM user_sentences WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
  return json({ success: true, sentences: results.map((r) => ({ id: r.id, chinese: r.chinese, pinyin: r.pinyin, english: r.english, createdAt: r.created_at })) });
});

route('POST', '/api/sentences', async ({ request, env, body }) => {
  const user = await requireUser(request, env);
  const { chinese, pinyin: py, english } = body;
  if (!chinese || !py || !english) fail(400, 'All fields are required');
  const r = await env.DB.prepare('INSERT INTO user_sentences (user_id, chinese, pinyin, english) VALUES (?, ?, ?, ?)').bind(user.id, chinese, py, english).run();
  return json({ success: true, message: 'Sentence added', sentence: { id: r.meta.last_row_id, chinese, pinyin: py, english } });
});

route('POST', '/api/sentences/practice', async ({ request, env }) => {
  await requireUser(request, env);
  return json({ success: true, mastery: 0 });
});

route('DELETE', '/api/sentences/(\\d+)', async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  await env.DB.prepare('DELETE FROM user_sentences WHERE id = ? AND user_id = ?').bind(Number(params[0]), user.id).run();
  return json({ success: true, message: 'Sentence deleted' });
});

// Example sentences for a ZhongMap character (CharacterDetail / SentencePractice screens).
route('GET', '/api/sentences/([^/]+)', async ({ request, env, params }) => {
  await requireUser(request, env);
  const ch = decodeURIComponent(params[0]);
  const entry = (await dataFile(env, `chars/${bucketOf(ch, CHAR_BUCKETS)}.json`))[ch] || { meaning: '', sentences: [] };
  return json({ success: true, senses: [{ senseId: 0, meaning: entry.meaning, mastery: 0, sentences: entry.sentences }] });
});

route('GET', '/api/word-edits/([^/]+)/([^/]+)', async ({ request, env, params }) => {
  await requireUser(request, env);
  const row = await env.DB.prepare('SELECT * FROM word_edits WHERE word = ? AND word_type = ?')
    .bind(decodeURIComponent(params[0]), decodeURIComponent(params[1])).first();
  return json({ success: true, edit: row ? { meanings: JSON.parse(row.edited_meanings), editedAt: row.updated_at } : null });
});

route('POST', '/api/word-edits', async ({ request, env, body }) => {
  const user = await requireUser(request, env);
  if (!user.can_edit_definitions) fail(403, 'No permission to edit definitions');
  const { word, wordType, meanings } = body;
  if (!word || !wordType || !Array.isArray(meanings)) fail(400, 'word, wordType and meanings are required');
  await env.DB.prepare(`INSERT INTO word_edits (word, word_type, edited_meanings, edited_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(word, word_type) DO UPDATE SET edited_meanings = excluded.edited_meanings, updated_at = CURRENT_TIMESTAMP`)
    .bind(word, wordType, JSON.stringify(meanings), user.id).run();
  return json({ success: true });
});

// ----- PhrasePump YouTube extension -----

route('GET', '/api/pp/words', async ({ request, env }) => {
  const user = await requireUser(request, env);
  const { status } = await userWords(env, user.id);
  const words = {};
  for (const [w, s] of status) if (s !== 'unknown') words[w] = { status: s };
  return json({ words });
});

route('POST', '/api/pp/words', async ({ request, env, body }) => {
  const user = await requireUser(request, env);
  const word = typeof body.word === 'string' ? body.word.trim().slice(0, 50) : '';
  if (!word || !HAN.test(word)) fail(400, 'Chinese word required');
  // {status}; older extension builds send {known: boolean}.
  const status = typeof body.known === 'boolean' ? (body.known ? 'known' : 'unknown') : body.status;
  if (!STATUSES.includes(status)) fail(400, 'status must be known, learning, ignored or unknown');
  // A word marked learning on YouTube shows up in Daily Sentences straight away.
  await saveWord(env, user.id, word, status, status === 'learning' ? { due: Date.now() } : {});
  return json({ word, status, known: status === 'known' });
});

route('GET', '/api/pp/lookup', async ({ request, env, url }) => {
  await requireUser(request, env);
  const word = (url.searchParams.get('word') || '').trim().slice(0, 20);
  if (!word || !HAN.test(word)) fail(400, 'Chinese word required');
  const entry = await dictEntry(env, word);
  let meaning = entry ? entry[1] : await meaningOf(env, word);
  if (!meaning) meaning = await googleTranslate(word, 'en').catch(() => '');
  return json({ word, pinyin: entry ? entry[0] : pinyin(word, { toneType: 'symbol' }).replace(/\s+/g, ''), meaning });
});

// Older extension builds batch hover look-ups here; newer ones read public/data/dict directly.
route('POST', '/api/pp/lookup-batch', async ({ request, env, body }) => {
  await requireUser(request, env);
  if (!Array.isArray(body.words)) fail(400, 'words must be an array');
  const words = body.words.filter((w) => typeof w === 'string' && w.length <= 20 && HAN.test(w)).slice(0, 500);
  const buckets = [...new Set(words.map((w) => bucketOf(w, DICT_BUCKETS)))].slice(0, 30); // stay under 50 subrequests
  const out = {};
  for (const b of buckets) {
    const file = await dataFile(env, `dict/${b}.json`);
    for (const w of words) if (bucketOf(w, DICT_BUCKETS) === b && file[w]) out[w] = { pinyin: file[w][0], meaning: file[w][1] };
  }
  return json({ words: out });
});

route('POST', '/api/pp/translate', async ({ request, env, body }) => {
  await requireUser(request, env);
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : '';
  const to = body.to || 'en';
  if (!text) fail(400, 'text required');
  if (to !== 'en' && to !== 'zh-CN') fail(400, 'to must be en or zh-CN');
  const out = await googleTranslate(text, to).catch((error) => { console.error('translate', error.message); return ''; });
  return json({ text: out, en: to === 'en' ? out : '' });
});

route('POST', '/api/pp/translate-batch', async ({ request, env, body }) => {
  await requireUser(request, env);
  const to = body.to || 'en';
  if (to !== 'en' && to !== 'zh-CN') fail(400, 'to must be en or zh-CN');
  if (!Array.isArray(body.texts)) fail(400, 'texts must be an array');
  const texts = body.texts.slice(0, 200).map((t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, 500) : ''));
  return json({ texts: await translateMany(texts, to) });
});

// Saved subtitle lines become the user's own sentences.
route('POST', '/api/pp/phrases', async ({ request, env, body }) => {
  const user = await requireUser(request, env);
  const zh = typeof body.zh === 'string' ? body.zh.trim().slice(0, 500) : '';
  if (!zh) fail(400, 'zh required');
  const exists = () => env.DB.prepare('SELECT id FROM user_sentences WHERE user_id = ? AND chinese = ?').bind(user.id, zh).first();
  if (await exists()) return json({ created: false });
  let en = typeof body.en === 'string' ? body.en.trim().slice(0, 1000) : '';
  if (!en) en = await googleTranslate(zh, 'en').catch(() => '');
  const py = pinyin(zh, { toneType: 'symbol', nonZh: 'consecutive' }).replace(/\s+([，。！？、；：,.!?;:])/g, '$1');
  if (await exists()) return json({ created: false }); // a second quick save of the same line
  await env.DB.prepare('INSERT INTO user_sentences (user_id, chinese, pinyin, english) VALUES (?, ?, ?, ?)').bind(user.id, zh, py, en || '(no translation)').run();
  return json({ created: true }, 201);
});

// ----- Daily Sentences -----

function pickSentence(candidates, word, status, exclude) {
  let best = null;
  let bestScore = Infinity;
  for (const s of candidates) {
    if (exclude.has(s[0])) continue;
    let unknown = 0;
    let words = 0;
    for (const t of s[3]) {
      if (!Array.isArray(t)) continue;
      words++;
      if (t[0] !== word && !isKnownish(status.get(t[0]))) unknown++;
    }
    // Few unknown words, but long enough to be real reading.
    const score = unknown * 4 - Math.min(words, 14) + (s[1].length < 10 ? 20 : 0);
    if (score < bestScore) { best = s; bestScore = score; }
  }
  return best;
}

route('GET', '/api/pump/next', async ({ request, env, url }) => {
  const user = await requireUser(request, env);
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 10));
  const now = Date.now();
  const day = today();
  const [u, dayRow, seen] = await Promise.all([
    userWords(env, user.id),
    env.DB.prepare('SELECT done, new_words FROM pump_days WHERE user_id = ? AND day = ?').bind(user.id, day).first(),
    env.DB.prepare('SELECT sentence_id FROM pump_seen WHERE user_id = ? AND at > ?').bind(user.id, now - 30 * DAY_MS).all(),
  ]);
  const done = dayRow?.done || 0;
  const newToday = dayRow?.new_words || 0;
  const exclude = new Set(seen.results.map((r) => r.sentence_id));
  const cards = [];
  const used = new Set();
  let lookups = 0;
  const add = async (word, kind, times) => {
    if (used.has(word) || cards.length >= limit || lookups >= 40) return 0; // stay under 50 subrequests
    used.add(word);
    lookups++;
    const candidates = await pumpCandidates(env, word);
    let added = 0;
    while (added < times && cards.length < limit) {
      const s = pickSentence(candidates, word, u.status, exclude);
      if (!s) break;
      exclude.add(s[0]);
      cards.push({
        id: s[0], zh: s[1], en: s[2], target: word, kind,
        tokens: s[3].map((t) => (Array.isArray(t) ? { w: t[0], p: t[1], s: u.status.get(t[0]) || 'new', m: t[2] } : { t })),
      });
      added++;
    }
    return added;
  };
  const shownToday = (w) => (u.srs.get(w)?.shownDay === day ? u.srs.get(w).reps || 0 : 0);
  const learning = [...u.status].filter(([, s]) => s === 'learning').map(([w]) => w)
    .sort((a, b) => (u.srs.get(a)?.due || 0) - (u.srs.get(b)?.due || 0));
  for (const w of learning.filter((w) => (u.srs.get(w)?.due || 0) <= now)) await add(w, 'review', Math.max(1, PUMP_PER_WORD - shownToday(w)));

  let newLeft = PUMP_NEW_PER_DAY - newToday;
  if (newLeft > 0 && cards.length < limit) {
    for (const w of await dataFile(env, 'pump/words.json')) { // frequency order, dictionary words with sentences only
      if (newLeft <= 0 || cards.length >= limit || lookups >= 40) break;
      const s = u.status.get(w);
      if (s && s !== 'unknown') continue;
      if (await add(w, 'new', PUMP_PER_WORD)) newLeft--;
    }
  }
  // Daily goal not met and nothing due: one more sentence each for words you're learning.
  if (done + cards.length < PUMP_GOAL) for (const w of learning) await add(w, 'extra', 1);
  return json({ cards, done, goal: PUMP_GOAL, newToday, newPerDay: PUMP_NEW_PER_DAY });
});

// One POST per card ("Next"): the statuses tapped on that card. The target stays learning until marked
// known/ignored; after PUMP_PER_WORD sentences today it waits for tomorrow.
route('POST', '/api/pump/answer', async ({ request, env, body }) => {
  const user = await requireUser(request, env);
  const sentenceId = Number(body.sentenceId);
  const target = typeof body.target === 'string' ? body.target : '';
  const marks = body.words && typeof body.words === 'object' ? body.words : {};
  if (!Number.isInteger(sentenceId) || !target || !HAN.test(target)) fail(400, 'sentenceId and target required');
  const now = Date.now();
  const day = today();
  const u = await userWords(env, user.id);
  const wasNew = !u.status.has(target) || u.status.get(target) === 'unknown';
  for (const w of Object.keys(marks).slice(0, 20)) {
    if (w === target || w.length > 50 || !HAN.test(w) || !STATUSES.includes(marks[w])) continue;
    const existing = u.srs.get(w);
    await saveWord(env, user.id, w, marks[w], marks[w] === 'learning' ? (existing?.due ? existing : { due: now }) : {});
  }
  const targetMark = STATUSES.includes(marks[target]) ? marks[target] : 'learning';
  if (targetMark !== 'learning') {
    await saveWord(env, user.id, target, targetMark);
  } else {
    const card = u.srs.get(target) || {};
    if (!(body.kind === 'extra' && card.due)) { // an extra sentence for a word already done today leaves its schedule alone
      const shown = (card.shownDay === day ? card.reps || 0 : 0) + 1;
      await saveWord(env, user.id, target, 'learning', { due: shown >= PUMP_PER_WORD ? Date.parse(day) + DAY_MS : now, reps: shown, shownDay: day });
    }
  }
  const dayRow = await env.DB.prepare('SELECT done, new_words FROM pump_days WHERE user_id = ? AND day = ?').bind(user.id, day).first();
  const done = (dayRow?.done || 0) + 1;
  const newToday = (dayRow?.new_words || 0) + (wasNew ? 1 : 0);
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO pump_seen (user_id, sentence_id, at) VALUES (?, ?, ?)').bind(user.id, sentenceId, now),
    env.DB.prepare('INSERT OR REPLACE INTO pump_days (user_id, day, done, new_words) VALUES (?, ?, ?, ?)').bind(user.id, day, done, newToday),
  ]);
  return json({ done, goal: PUMP_GOAL, newToday });
});

// ---------- entry ----------

// Credentialed cross-origin calls only from the PhrasePump extension; the web app is same-origin.
function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  if (!origin.startsWith('chrome-extension://')) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      const match = routes.find((r) => r.method === request.method && r.pattern.test(url.pathname));
      if (!match) {
        response = json({ success: false, error: 'Not found' }, 404);
      } else {
        const body = request.method === 'POST' || request.method === 'PUT' ? await request.json().catch(() => ({})) : {};
        response = await match.handler({ request, env, url, body: body || {}, params: url.pathname.match(match.pattern).slice(1) });
      }
    } catch (error) {
      if (error instanceof HttpError) response = json(error.body, error.status);
      else {
        console.error(request.method, url.pathname, error.stack || error.message);
        response = json({ success: false, error: 'Server error' }, 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};
