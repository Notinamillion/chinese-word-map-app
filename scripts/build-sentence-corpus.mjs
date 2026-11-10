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
const meanings = new Map(); // simplified word -> short meaning
for (const line of fs.readFileSync(cedictPath, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s+(\S+)\s+\[[^\]]+\]\s+\/(.+)\//);
  if (!m) continue;
  const [, trad, simp, defs] = m;
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
  // Up to 3 whole senses within ~90 characters (never cut mid-word).
  let def = '';
  for (const d of defs.split('/').filter((x) => !/^(CL:|variant of|old variant|see )/.test(x)).slice(0, 3)) {
    const next = def ? `${def}; ${d}` : d;
    if (def && next.length > 90) break;
    def = next;
  }
  if (def && !meanings.has(simp)) meanings.set(simp, def);
}
// shortcut: char-level conversion picks the most common mapping, so ambiguous chars (乾→干/乾, 著→着/著) can be wrong; use OpenCC if it matters.
const t2s = new Map([...t2sCounts].filter(([c]) => !simpChars.has(c)).map(([c, counts]) => [c, [...counts].sort((a, b) => b[1] - a[1])[0][0]]));
const toSimp = (s) => Array.from(s).map((c) => t2s.get(c) || c).join('');

// --- Tatoeba pairs ---
const eng = new Map(tsv('eng_sentences.tsv').map(([id, , text]) => [id, text]));
const firstEn = new Map();
for (const [cmn, en] of tsv('cmn-eng_links.tsv')) if (!firstEn.has(cmn) && eng.has(en)) firstEn.set(cmn, eng.get(en));

const seg = new Intl.Segmenter('zh', { granularity: 'word' }); // same segmenter as the PhrasePump extension
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
  for (const part of seg.segment(zh)) {
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
  words[w] = [rank + 1, meanings.get(w) || ''];
});

// Self-check: tokens rebuild the sentence, and pinyin exists for every word.
for (const [, zh, , t] of sentences) {
  assert.equal(t.map((x) => (Array.isArray(x) ? x[0] : x)).join(''), zh);
  assert.ok(t.every((x) => !Array.isArray(x) || x[1]));
}

fs.writeFileSync(outPath, JSON.stringify({ v: 1, words, s: sentences }));
console.log(`${sentences.length} sentences, ${Object.keys(words).length} words -> ${outPath} (${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB)`);
const sample = sentences.find((s) => s[1].includes('是否'));
console.log(JSON.stringify(sample));
console.log('top words:', Object.keys(words).slice(0, 15).join(' '));
