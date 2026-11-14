// Which static data file a word lives in. Shared by the data build script and the Worker
// (and copied into the PhrasePump extension) — they must agree, so change all of them together.
export const DICT_BUCKETS = 256; // public/data/dict/<n>.json   word -> [pinyin, meaning]
export const PUMP_BUCKETS = 512; // public/data/pump/<n>.json   word -> candidate sentences
export const CHAR_BUCKETS = 64;  // public/data/chars/<n>.json  char -> example sentences
export const COMPOUND_BUCKETS = 256; // public/data/compounds/<n>.json  word -> ZhongMap chars listing it

// FNV-1a over UTF-16 code units: stable across Node, Workers and browsers.
export function bucketOf(word, buckets) {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % buckets;
}
