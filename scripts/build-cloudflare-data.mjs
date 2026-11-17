// Splits ZhongMap's big read-only data into small static files for the Cloudflare Worker (free plan:
// 10 ms CPU per request, so the Worker reads one small file instead of parsing 20 MB).
// Usage: node scripts/build-cloudflare-data.mjs <sentence-corpus.json> <word-meanings.json> <characters.json> [cedict_ts.u8]
// Output: cloudflare/public/data/{dict,pump,chars,compounds}/<bucket>.json and pump/words.json
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pinyin } from 'pinyin-pro';
import { fillPumpGlosses } from './pump-glosses.mjs';
import { bucketOf, DICT_BUCKETS, PUMP_BUCKETS, CHAR_BUCKETS, COMPOUND_BUCKETS } from '../cloudflare/src/buckets.js';

const [corpusPath, meaningsPath, charactersPath, cedictPath] = process.argv.slice(2); // CC-CEDICT: better card glosses
if (!charactersPath) throw new Error('usage: build-cloudflare-data.mjs <sentence-corpus.json> <word-meanings.json> <characters.json>');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const meanings = JSON.parse(fs.readFileSync(meaningsPath, 'utf8'));
const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));
const out = path.join(import.meta.dirname, '..', 'cloudflare', 'public', 'data');
fs.rmSync(out, { recursive: true, force: true });

function writeBuckets(dir, count, map) {
  const buckets = Array.from({ length: count }, () => ({}));
  for (const [key, value] of map) buckets[bucketOf(key, count)][key] = value;
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  buckets.forEach((b, i) => fs.writeFileSync(path.join(out, dir, `${i}.json`), JSON.stringify(b)));
  const sizes = buckets.map((b) => JSON.stringify(b).length);
  console.log(`${dir}: ${map.size} keys in ${count} files, largest ${(Math.max(...sizes) / 1024).toFixed(0)} KB`);
}
const short = (m) => {
  // Token meanings in sentence cards: the first senses, up to ~60 characters.
  let s = '';
  for (const part of (m || '').split(/;\s*/)) {
    if (s && s.length + part.length > 60) break;
    s = s ? `${s}; ${part}` : part;
  }
  return s;
};

// 1. Dictionary for hover look-ups: word -> [pinyin, meaning]
const dict = new Map(Object.entries(meanings).map(([w, m]) => [w, [pinyin(w, { toneType: 'symbol' }).replace(/\s+/g, ''), m]]));
writeBuckets('dict', DICT_BUCKETS, dict);

// 2. Daily Sentences: target words in frequency order, and ~10 candidate sentences per word.
const byWord = new Map();
for (const s of corpus.s) {
  for (const t of s[3]) if (Array.isArray(t)) (byWord.get(t[0]) || byWord.set(t[0], new Set()).get(t[0])).add(s);
}
const words = Object.keys(corpus.words).filter((w) => corpus.words[w][1] && byWord.has(w));
fs.mkdirSync(path.join(out, 'pump'), { recursive: true });
fs.writeFileSync(path.join(out, 'pump', 'words.json'), JSON.stringify(words));
const card = (s) => [s[0], s[1], s[2], s[3].map((t) => (Array.isArray(t) ? [t[0], t[1], short(corpus.words[t[0]]?.[1] || meanings[t[0]])] : t))];
// Prefer real reading length (about 22 characters), never under 10 if there's a choice.
const lengthScore = (s) => (s[1].length < 10 ? 100 : Math.abs(s[1].length - 22));
const pump = new Map(words.map((w) => [w, [...byWord.get(w)].sort((a, b) => lengthScore(a) - lengthScore(b)).slice(0, 10).map(card)]));
writeBuckets('pump', PUMP_BUCKETS, pump);

// Every card word gets a gloss: fills names, numbers and 很好-style pieces, and tidies the CC-CEDICT wording.
console.log(fillPumpGlosses(out, cedictPath));

// 3. Example sentences per ZhongMap character (CharacterDetail / SentencePractice screens).
const chars = new Map();
for (const ch of Object.keys(characters)) {
  const found = [];
  for (const s of corpus.s) {
    if (found.length >= 15) break;
    if (s[1].includes(ch)) found.push({ id: s[0], chinese: s[1], english: s[2], pinyin: s[3].map((t) => (Array.isArray(t) ? t[1] : t)).join(' ') });
  }
  chars.set(ch, { meaning: characters[ch].meanings?.[0] || '', sentences: found });
}
writeBuckets('chars', CHAR_BUCKETS, chars);

// 4. Which ZhongMap characters list a word as a compound (words marked known on YouTube show there).
const compounds = new Map();
for (const [ch, data] of Object.entries(characters)) {
  for (const c of data.compounds || []) (compounds.get(c.word) || compounds.set(c.word, []).get(c.word)).push(ch);
}
writeBuckets('compounds', COMPOUND_BUCKETS, compounds);

// Self-checks on known words.
const read = (dir, key, count) => JSON.parse(fs.readFileSync(path.join(out, dir, `${bucketOf(key, count)}.json`), 'utf8'))[key];
assert.match(read('dict', '从', DICT_BUCKETS)[1], /^from/);
assert.equal(read('dict', '螺丝', DICT_BUCKETS)[0], 'luósī');
assert.ok(read('pump', '是否', PUMP_BUCKETS).length >= 5);
assert.ok(read('pump', '是否', PUMP_BUCKETS).every((c) => c[3].some((t) => Array.isArray(t) && t[0] === '是否')));
assert.ok(read('chars', '的', CHAR_BUCKETS).sentences.length === 15);
assert.ok(read('compounds', '的士', COMPOUND_BUCKETS).includes('的'));
assert.equal(words[0], corpus.words[words[0]] && words[0]);
let total = 0;
for (const dir of ['dict', 'pump', 'chars', 'compounds']) for (const f of fs.readdirSync(path.join(out, dir))) total += fs.statSync(path.join(out, dir, f)).size;
console.log(`total ${(total / 1e6).toFixed(1)} MB, ${words.length} target words`);
