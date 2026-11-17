// Builds the sentence corpus for the daily sentence mode (server: /api/pump/*).
// Usage: node scripts/build-sentence-corpus.mjs <tatoeba-dir> <cedict_ts.u8> <out.json>
// <tatoeba-dir> holds cmn_sentences.tsv, eng_sentences.tsv, cmn-eng_links.tsv from downloads.tatoeba.org/exports/per_language.
// Heavy work happens here (Node 18+) so the NAS's Node 12 server only loads the result.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pinyin } from 'pinyin-pro';

const [dir, cedictPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('usage: build-sentence-corpus.mjs <tatoeba-dir> <cedict_ts.u8> <out.json>');

const tsv = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const HAN = /[㐀-鿿]/;

// --- CEDICT: traditional→simplified char map and word meanings ---
const t2sCounts = new Map(); // trad char -> Map(simp char -> count)
const simpChars = new Set(); // chars that occur in simplified headwords are never converted (么 must not become 幺)
const entries = new Map(); // simplified word -> [{ py, defs }] in dictionary order
for (const line of fs.readFileSync(cedictPath, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\//);
  if (!m) continue;
  const [, trad, simp, py, defs] = m;
  if (!entries.has(simp)) entries.set(simp, []);
  entries.get(simp).push({ py, defs: defs.split('/') });
  const tc = Array.from(trad), sc = Array.from(simp);
  sc.forEach((c) => simpChars.add(c));
  if (tc.length === sc.length) {
    tc.forEach((c, i) => {
      if (c === sc[i]) return;
      const counts = t2sCounts.get(c) || new Map();
      counts.set(sc[i], (counts.get(sc[i]) || 0) + 1);
      t2sCounts.set(c, counts);
    });
  }
}

// CC-CEDICT often lists a surname / proper-noun entry first (从 "surname Cong" before "from"), and some
// words have two readings (东西 dōngxī "east and west" vs dōngxi "thing"). Order a word's entries:
// common nouns before proper nouns, colloquial neutral-tone readings first, then the usual pronunciation.
const SKIP_SENSE = /^(CL:|variant of|old variant|see |surname |used in |\(surname\)|also written|erhua variant)/;
const toneless = (p) => p.toLowerCase().replace(/u:/g, 'v').replace(/[^a-zv]/g, '');
function meaningOf(word) {
  const list = entries.get(word);
  if (!list) return '';
  const usual = pinyin(word, { toneType: 'num', type: 'array' }).join('').toLowerCase().replace(/0/g, '5');
  const score = (e) => {
    if (/^[A-Z]/.test(e.py)) return 3; // proper noun
    // Neutral-tone readings are the everyday ones: particles (了 le, 的 de) and colloquial words (东西 dongxi).
    if (/[a-z]5\b/.test(e.py) && (Array.from(word).length === 1 || list.some((o) => o !== e && toneless(o.py) === toneless(e.py)))) return 0;
    if (e.py.replace(/\s/g, '').toLowerCase().replace(/u:/g, 'v') === usual) return 1;
    return 2;
  };
  const ordered = list.map((e, i) => ({ e, s: score(e), i })).sort((a, b) => a.s - b.s || a.i - b.i);
  // Up to 3 whole senses within ~90 characters (never cut mid-word), from the best entry that has any.
  for (const { e } of ordered) {
    let def = '';
    for (const d of e.defs.filter((x) => x && !SKIP_SENSE.test(x)).map((x) => x.replace(/^\((bound form|literary)\)\s*/, '')).slice(0, 3)) {
      const next = def ? `${def}; ${d}` : d;
      if (def && next.length > 90) break;
      def = next;
    }
    if (def) return def;
  }
  return '';
}
// shortcut: char-level conversion picks the most common mapping, so ambiguous chars (乾→干/乾, 著→着/著) can be wrong; use OpenCC if it matters.
const t2s = new Map([...t2sCounts].filter(([c]) => !simpChars.has(c)).map(([c, counts]) => [c, [...counts].sort((a, b) => b[1] - a[1])[0][0]]));
const toSimp = (s) => Array.from(s).map((c) => t2s.get(c) || c).join('');

// --- Tatoeba pairs ---
const eng = new Map(tsv('eng_sentences.tsv').map(([id, , text]) => [id, text]));
const firstEn = new Map();
for (const [cmn, en] of tsv('cmn-eng_links.tsv')) if (!firstEn.has(cmn) && eng.has(en)) firstEn.set(cmn, eng.get(en));

const seg = new Intl.Segmenter('zh', { granularity: 'word' }); // same segmenter as the PhrasePump extension

// The segmenter leaves words it doesn't know as single characters (客|服, 俱|乐|部, 一|会|儿): join runs of
// single characters back into the longest dictionary word, but not grammar endings (车|坏|了 stays apart).
// shortcut: hand-picked dictionary words that are usually two words in these sentences (我等你, 把门关上); add more if they show up.
const NOT_JOINED = new Set(['我等', '你等', '他等', '把门', '在下', '这不', '要说', '想来', '要看', '出外', '一会']);
const single = (p) => p.isWordLike && HAN.test(p.segment) && Array.from(p.segment).length === 1;
function joinWords(parts) {
  const out = [];
  for (let i = 0; i < parts.length; ) {
    let n = 1;
    for (let k = Math.min(4, parts.length - i); k > 1; k--) {
      const run = parts.slice(i, i + k);
      const word = run.map((p) => p.segment).join('');
      if (run.every(single) && entries.has(word) && !/[的了着过]$/.test(word) && !NOT_JOINED.has(word)) { n = k; break; }
    }
    out.push(n === 1 ? parts[i] : { segment: parts.slice(i, i + n).map((p) => p.segment).join(''), isWordLike: true });
    i += n;
  }
  return out;
}
const joined = (s) => joinWords([...seg.segment(s)]).map((p) => p.segment).join('|');
assert.equal(joined('他等火车的时候，一会儿听音乐'), '他|等|火车|的|时候|，|一会儿|听|音乐');
assert.ok(joined('我的车坏了').endsWith('坏|了'));
const seen = new Set();
const sentences = [];
const counts = new Map();
for (const [id, , raw] of tsv('cmn_sentences.tsv')) {
  const en = firstEn.get(id);
  if (!en) continue;
  const zh = toSimp(raw.trim());
  const len = Array.from(zh).length;
  if (len < 4 || len > 30 || /[A-Za-z]/.test(zh) || seen.has(zh)) continue;
  seen.add(zh);

  // Pinyin for the whole sentence keeps polyphones in context; slice it per token.
  const chars = Array.from(zh);
  const py = pinyin(zh, { type: 'array', toneType: 'symbol', nonZh: 'spaced' });
  const aligned = py.length === chars.length;
  let pos = 0;
  const tokens = [];
  for (const part of joinWords([...seg.segment(zh)])) {
    const n = Array.from(part.segment).length;
    if (part.isWordLike && HAN.test(part.segment)) {
      const p = aligned ? py.slice(pos, pos + n).join('') : pinyin(part.segment, { toneType: 'symbol' }).replace(/\s+/g, '');
      tokens.push([part.segment, p]);
      counts.set(part.segment, (counts.get(part.segment) || 0) + 1);
    } else {
      tokens.push(part.segment);
    }
    pos += n;
  }
  sentences.push([Number(id), zh, en, tokens]);
}

const words = {};
[...counts].sort((a, b) => b[1] - a[1]).forEach(([w], rank) => {
  words[w] = [rank + 1, meaningOf(w)];
});

// Self-check: tokens rebuild the sentence, and pinyin exists for every word.
for (const [, zh, , t] of sentences) {
  assert.equal(t.map((x) => (Array.isArray(x) ? x[0] : x)).join(''), zh);
  assert.ok(t.every((x) => !Array.isArray(x) || x[1]));
}

// Meanings must be the everyday sense, not a surname or the rarer reading.
for (const [w, re] of [['从', /^from/], ['东西', /^thing/], ['会', /^can/], ['了', /completed action/], ['张', /^to open|^to spread|classifier/]]) {
  assert.match(words[w]?.[1] || '', re, w);
}

fs.writeFileSync(outPath, JSON.stringify({ v: 1, words, s: sentences }));

// Every CC-CEDICT word's everyday meaning, next to the corpus: hover look-ups for YouTube words never need
// machine translation (Google rate-limits the NAS).
const allMeanings = {};
for (const word of entries.keys()) {
  if (!HAN.test(word)) continue;
  const meaning = meaningOf(word);
  if (meaning) allMeanings[word] = meaning;
}
const meaningsPath = path.join(path.dirname(outPath), 'word-meanings.json');
fs.writeFileSync(meaningsPath, JSON.stringify(allMeanings));
console.log(`${Object.keys(allMeanings).length} dictionary meanings -> ${meaningsPath} (${(fs.statSync(meaningsPath).size / 1e6).toFixed(1)} MB)`);
console.log(`${sentences.length} sentences, ${Object.keys(words).length} words -> ${outPath} (${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB)`);
const sample = sentences.find((s) => s[1].includes('是否'));
console.log(JSON.stringify(sample));
console.log('top words:', Object.keys(words).slice(0, 15).join(' '));
