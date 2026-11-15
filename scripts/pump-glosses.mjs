// Gives every word in the sentence cards (public/data/pump) a short, readable gloss, in place.
// Reads the built data (dict + pump buckets); with CC-CEDICT (cedict_ts.u8 from mdbg.net) it also picks the
// sense for the reading the card uses (当 dāng "when", not "ding dong") and resolves variants (鉄 -> 铁 iron).
// Usage: node scripts/pump-glosses.mjs [cloudflare/public/data] [cedict_ts.u8]   (build-cloudflare-data.mjs runs it too)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

const readDir = (dir) => fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));

// Tidy a CC-CEDICT meaning: drop cross-references and long asides, repeated senses, keep ~3 short senses.
export function clean(meaning) {
  const senses = [];
  for (let s of meaning.split(/;\s*/)) {
    const bare = s;
    if (/Taiwan pr\./.test(s)) continue; // a reading the card isn't using
    s = s.replace(/\s*\(?abbr\. (?:to|for)[^)]*\)?/g, '')
      .replace(/\s*\[[a-zA-Z0-9: ]+\]/g, '') // pinyin refs like 您[nin2]
      .replace(/\s*\([^()]*[㐀-鿿][^()]*\)/g, '') // asides naming other Chinese words
      .replace(/\s*[㐀-鿿]+\|[㐀-鿿]+/g, '') // trad|simp refs like 兩|两
      .replace(/\s*\(colloquial pr\.\)|^also pr\.$/g, '')
      .replace(/^\([^()]*\)\s+(?=\S)/, '') // leading labels: "(pronoun) this", "(third-person singular) he"
      .replace(/\s*\([^()]*[㐀-鿿][^()]*\)/g, '') // asides naming other Chinese words
      .replace(/\s*\([^()]{24,}\)/g, '') // long asides: "(followed by substantives only)"
      .replace(/\bsth\b/g, 'something').replace(/\bsb\b/g, 'someone')
      .replace(/^[㐀-鿿|]+$/, '')
      .trim();
    if (!s) s = /^\(.*\)$/.test(bare) && !/[㐀-鿿]/.test(bare) ? bare : ''; // keep "(completed action marker)"
    if (s && !senses.includes(s)) senses.push(s);
  }
  let out = '';
  for (const s of senses.slice(0, 3)) {
    if (out && out.length + s.length > 50) break;
    out = out ? `${out}; ${s}` : s;
  }
  if (!out) out = meaning.replace(/\s*\[[a-zA-Z0-9: ]+\]/g, '').split(/;\s*/)[0]; // all asides: keep the first as is
  // Places read "Tokyo, capital of Japan" in CC-CEDICT: say "Tokyo (place)".
  return out.replace(/^([A-Z][\w'-]*(?: [A-Z][\w'-]*)*),? (?:the )?(?:capital|city|province|county|municipality|town|district|prefecture|river|island)\b.*$/, '$1 (place)');
}

// Reading as letters + tone digits, neutral tone left out: "dāng" and "dang1" -> "dang|1", "yìxiē" -> "yixie|4".
const MARKS = { '̄': 1, '́': 2, '̌': 3, '̀': 4 };
export function toneKey(p) {
  let letters = '', tones = '';
  for (const ch of p.toLowerCase().replace(/u:/g, 'v').normalize('NFD')) {
    if (MARKS[ch]) tones += MARKS[ch];
    else if (ch === '\u0308') letters = letters.replace(/u$/, 'v');
    else if (/[1-4]/.test(ch)) tones += ch;
    else if (/[a-z]/.test(ch)) letters += ch;
  }
  return `${letters}|${tones}`;
}
const CEDICT_SKIP = /^(CL:|(old )?variant of|see |surname |used in |also written|erhua variant|Taiwan pr\.|also pr\.|abbr\. for)/;

// CC-CEDICT gloss for a word as read in its sentence; '' when CC-CEDICT doesn't know it.
// With dictGloss (what dict/ already says), it only overrides when that gloss came from another reading
// (於 wū "Oh!" for yú) or from a rare same-reading form (噹 "ding dong" where 當 "to be; when" is meant).
export function makeCedict(text) {
  const entries = new Map(); // simplified AND traditional form -> entries
  const headwords = new Map(); // traditional char -> number of headwords using it: 當 256, 噹 12
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\//);
    if (!m) continue;
    const e = { trad: m[1], simp: m[2], py: m[3], defs: m[4].split('/') };
    for (const k of new Set([e.simp, e.trad])) (entries.get(k) || entries.set(k, []).get(k)).push(e);
    for (const c of new Set(e.trad)) headwords.set(c, (headwords.get(c) || 0) + 1);
  }
  const common = (e) => Math.min(...[...e.trad].map((c) => headwords.get(c) || 0));
  const ref = (d) => d.match(/([^\s|\[\]]+)\|?([^\s|\[\]]*)\[([^\]]+)\]/); // 隻|只[zhi1] -> traditional, simplified, reading
  const resolve = (e, depth) => {
    const usable = e.defs.filter((d) => !CEDICT_SKIP.test(d));
    if (usable.length) return usable.join('; ');
    for (const d of e.defs) {
      const r = ref(d);
      if (!r || depth > 1) continue;
      const g = pick(r[1], r[3], undefined, depth + 1); // look up by the traditional form: 只 -> 隻, not back to 只
      if (g && /^(old )?variant of|^see |^also written/.test(d)) return g;
      if (g && /^used in /.test(d)) return `as in ${r[2] || r[1]} ${g.split(/;\s*/)[0]}`;
    }
    return e.defs.some((d) => /^surname /.test(d)) ? '(surname)' : '';
  };
  const firstSense = (s) => clean(s).split(/;\s*/)[0].toLowerCase();
  function pick(word, reading, dictGloss, depth = 0) {
    const all = (entries.get(word) || []).map((e) => ({ e, text: resolve(e, depth), common: common(e) })).filter((x) => x.text);
    const key = reading ? toneKey(reading) : '';
    const letters = (x) => toneKey(x.e.py).split('|')[0] === key.split('|')[0]; // tone sandhi: 一些 yìxiē = yi1 xie1
    const exact = all.filter((x) => toneKey(x.e.py) === key);
    const pool = exact.length ? exact : all.filter(letters).length ? all.filter(letters) : all;
    const best = pool.sort((a, b) => /^[A-Z]/.test(a.e.py) - /^[A-Z]/.test(b.e.py) || b.common - a.common)[0];
    if (!best || !dictGloss) return best?.text || '';
    const source = all.filter((x) => firstSense(x.text) === firstSense(dictGloss)).sort((a, b) => b.common - a.common)[0];
    // Card pinyin (pinyin-pro) rarely has neutral tones: 地 is always "dì", so never switch away from 地 de5 "-ly".
    if (!source || !key || /5/.test(source.e.py)) return dictGloss;
    if (!letters(source)) return best.text; // dict/ glossed another reading
    return best.common >= 10 * source.common ? best.text : dictGloss;
  }
  return pick;
}

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT = { 十: 10, 百: 100, 千: 1000, 万: 1e4, 亿: 1e8 };
// 三百六十 -> 360, 一九九七 -> 1997; '' when it isn't a plain number.
export function numberValue(w) {
  if (!/^[零〇一二两三四五六七八九十百千万亿]+$/.test(w)) return '';
  if (!/[十百千万亿]/.test(w)) return [...w].map((c) => DIGIT[c]).join('');
  let total = 0, section = 0, n = 0;
  for (const c of w) {
    if (c in DIGIT) n = DIGIT[c];
    else if (UNIT[c] >= 1e4) { total += (section + n) * UNIT[c]; section = 0; n = 0; }
    else { section += (n || 1) * UNIT[c]; n = 0; }
  }
  return String(total + section + n);
}

export function makeGlosser(dict, freq = new Map(), cedict = null) {
  const meaning = (w, reading) => (cedict && cedict(w, reading, dict[w]?.[1])) || dict[w]?.[1] || '';
  const first = (w, reading) => clean(meaning(w, reading)).split(/;\s*/)[0];
  // How often a character shows up in proper-noun entries: 萨 0.85, 斯 0.89, 我 0.04.
  // High for every character means a transliterated name the segmenter cut up (克里|斯, 萨|米).
  const seen = new Map(), names = new Map(), compounds = new Map();
  for (const [w, [, m]] of Object.entries(dict)) {
    if ([...w].length < 2) continue;
    const proper = /^[A-Z]/.test(m) && !/^(Chinese|English|CL)\b/.test(m);
    for (const c of new Set(w)) {
      seen.set(c, (seen.get(c) || 0) + 1);
      if (proper) names.set(c, (names.get(c) || 0) + 1);
      else (compounds.get(c) || compounds.set(c, []).get(c)).push(w);
    }
  }
  // Traditional -> simplified, learnt from the dictionary's own "兩|两" cross-references (閒 -> 闲, 傢 -> 家).
  const simpChars = new Set(Object.keys(dict).join(''));
  const t2sCounts = new Map();
  for (const [, m] of Object.values(dict)) {
    for (const [, t, s] of m.matchAll(/([㐀-鿿]+)\|([㐀-鿿]+)/g)) {
      const tc = [...t], sc = [...s];
      if (tc.length === sc.length) tc.forEach((c, k) => { if (c !== sc[k] && !simpChars.has(c)) t2sCounts.set(c + sc[k], (t2sCounts.get(c + sc[k]) || 0) + 1); });
    }
  }
  const t2s = new Map();
  for (const [pair, n] of [...t2sCounts].sort((a, b) => a[1] - b[1])) t2s.set([...pair][0], [...pair][1]); // most frequent wins
  const nameRatio =(c) => (seen.get(c) >= 5 ? (names.get(c) || 0) / seen.get(c) : 0);
  const looksLikeName = (w) => {
    const r = [...w].map(nameRatio);
    return Math.min(...r) >= 0.35 && r.reduce((a, b) => a + b) / r.length >= 0.5;
  };
  // A character with no entry of its own (only "used in …"): name it by its most common word.
  const asIn = (c) => {
    const best = (compounds.get(c) || []).sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0) || a.length - b.length)[0];
    return best && `as in ${best} ${first(best)}`;
  };
  // sentenceWords: the card's tokens ('|' for punctuation), i: this token's index in it, reading: its pinyin there.
  return function gloss(word, sentenceWords = [], i = -1, reading = '') {
    let w = word.replace(/[︀-️\u{E0100}-\u{E01EF}]/gu, ''); // variation selectors (拐󠄆) aren't characters
    const fromCedict = meaning(w, reading);
    const weak = /^as in |^\(surname\)$/.test(fromCedict); // 萨 "as in 菩萨" is less use than "used in foreign names"
    if (fromCedict && !weak) return clean(fromCedict);
    if (!dict[w]) w = [...w].map((c) => t2s.get(c) || c).join('');
    if (dict[w]) return clean(dict[w][1]);
    const num = numberValue(w);
    if (num) return num;
    // A run of neighbouring tokens that is a dictionary word: 珠穆朗|玛|峰 -> Mount Everest.
    // Only runs of 3+ characters: two-character merges (一个|人) are often accidental.
    for (let a = Math.max(0, i - 3); i >= 0 && a <= i; a++) {
      for (let b = Math.min(sentenceWords.length, i + 4); b > i && b - a > 1; b--) {
        const run = sentenceWords.slice(a, b).join('');
        if ([...run].length >= 3 && dict[run]) return `part of ${run}: ${first(run)}`;
      }
    }
    if (looksLikeName(w)) return [...w].length > 1 ? '(part of a name)' : '(sound used in foreign names)';
    if (fromCedict && fromCedict !== '(surname)') return clean(fromCedict);
    // Longest dictionary pieces, one sense each: 很好 -> "很 very · 好 good" (like the Worker's hover meanings).
    // Greedy from the left and from the right; keep the split whose rarest piece is commoner (不|知道, not 不知|道).
    const chars = [...w];
    const split = (fromRight) => {
      const out = [];
      for (let i = 0, j = chars.length; i < j;) {
        let k = fromRight ? i : j;
        if (fromRight) { while (k < j && !dict[chars.slice(k, j).join('')]) k++; if (k === j) k = j - 1; out.unshift(chars.slice(k, j).join('')); j = k; }
        else { while (k > i && !dict[chars.slice(i, k).join('')]) k--; if (k === i) k = i + 1; out.push(chars.slice(i, k).join('')); i = k; }
      }
      return out;
    };
    const rarest = (ps) => Math.min(...ps.map((p) => (dict[p] ? freq.get(p) || 1 : 0)));
    const [l, r] = [split(false), split(true)];
    const py = pinyin(w, { type: 'array', toneType: 'symbol' }); // per-character readings, so 一只 reads 只 as zhī
    let at = 0;
    const pieces = (rarest(r) > rarest(l) ? r : l).map((p) => {
      const n = [...p].length;
      const g = first(p, py.length === chars.length ? py.slice(at, at + n).join('') : '');
      at += n;
      return `${p} ${g || asIn(p) || '(rare character)'}`;
    });
    return pieces.length > 1 ? pieces.join(' · ') : pieces[0].replace(/^\S+ /, '');
  };
}

export function fillPumpGlosses(dataDir, cedictPath) {
  const dict = {};
  for (const f of readDir(path.join(dataDir, 'dict'))) Object.assign(dict, JSON.parse(fs.readFileSync(path.join(dataDir, 'dict', f), 'utf8')));
  const files = readDir(path.join(dataDir, 'pump')).map((f) => path.join(dataDir, 'pump', f));
  const buckets = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const freq = new Map();
  for (const b of buckets) for (const cards of Object.values(b)) for (const c of cards) for (const t of c[3]) if (Array.isArray(t)) freq.set(t[0], (freq.get(t[0]) || 0) + 1);
  const gloss = makeGlosser(dict, freq, cedictPath && makeCedict(fs.readFileSync(cedictPath, 'utf8')));
  let filled = 0;
  buckets.forEach((b, k) => {
    for (const cards of Object.values(b)) {
      for (const c of cards) {
        const words = c[3].map((t) => (Array.isArray(t) ? t[0] : '|')); // '|' never joins into a dictionary word
        for (const [i, t] of c[3].entries()) {
          if (!Array.isArray(t)) continue;
          if (!t[2]) filled++;
          t[2] = gloss(t[0], words, i, t[1]);
          assert.ok(t[2], `no gloss for ${t[0]}`);
        }
      }
    }
    fs.writeFileSync(files[k], JSON.stringify(b));
  });
  return { filled, words: freq.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || path.join(import.meta.dirname, '..', 'cloudflare', 'public', 'data');
  const { filled, words } = fillPumpGlosses(dir, process.argv[3]);
  console.log(`pump glosses: ${filled} empty tokens filled, ${words} distinct words`);
}
