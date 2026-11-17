// Every word in the sentence cards has a gloss, and the gloss rules hold.
// Run: node --test test/pump-glosses.test.mjs   (needs the built public/data; skips without it)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clean, numberValue, toneKey } from '../../scripts/pump-glosses.mjs';

const pump = path.join(import.meta.dirname, '..', 'public', 'data', 'pump');

test('gloss rules', () => {
  assert.equal(numberValue('三百六十'), '360');
  assert.equal(numberValue('一九九七'), '1997');
  assert.equal(numberValue('两万五千'), '25000');
  assert.equal(numberValue('十一'), '11');
  assert.equal(clean('you (informal, as opposed to courteous 您[nin2])'), 'you');
  assert.equal(clean('(completed action marker)'), '(completed action marker)');
  assert.equal(clean('Tokyo, capital of Japan'), 'Tokyo (place)');
  assert.equal(clean('to let sb do sth'), 'to let someone do something');
  assert.equal(toneKey('dāng'), toneKey('dang1'));
  assert.equal(toneKey('dōngxi'), toneKey('dong1 xi5'));
  assert.equal(toneKey('nǚrén'), toneKey('nu:3 ren2'));
});

test('every card word has a gloss', { skip: !fs.existsSync(pump) && 'no built data' }, () => {
  const missing = new Set();
  let words = 0;
  for (const f of fs.readdirSync(pump).filter((f) => /^\d+\.json$/.test(f))) {
    for (const cards of Object.values(JSON.parse(fs.readFileSync(path.join(pump, f), 'utf8')))) {
      for (const c of cards) for (const t of c[3]) if (Array.isArray(t)) { words++; if (!t[2]) missing.add(t[0]); }
    }
  }
  assert.ok(words > 100000, `only ${words} card words`);
  assert.deepEqual([...missing].slice(0, 20), []);
});
