// The examples (lib/examples.mjs): each one is code the language reads, every block of it sounds, and its tempo is one
// the page takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE, EXAMPLES } from '../lib/examples.mjs';
import { parseBlocks, query } from '../lib/pattern.mjs';

test('the examples: a name, a tempo the page takes, and blocks that each make sound over four bars', () => {
  assert.ok(EXAMPLES.length >= 5);
  assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length, 'ids are different');
  for (const ex of EXAMPLES) {
    assert.ok(ex.bpm >= 40 && ex.bpm <= 240, ex.id);
    const blocks = parseBlocks(ex.code);
    assert.ok(blocks.length >= 3, `${ex.id}: a few blocks`);
    for (const b of blocks) {
      const events = [0, 1, 2, 3].flatMap((bar) => query(b.pattern, bar, bar + 1));
      assert.ok(events.length, `${ex.id}: ${b.name} sounds`);
      for (const e of events) assert.ok(e.kind !== null || e.pitch !== null, `${ex.id}: ${b.name} has a sound or a note`);
    }
  }
});

test('the first example is what a first visit opens with', () => {
  assert.equal(EXAMPLE, EXAMPLES[0].code);
});
