// The live loop (lib/live.mjs): blocks of code bar after bar, new code on a bar line, mute and solo, the code in a link.
// And what the pattern language gives the live page: named blocks, and where in the code each event's words are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loop, codeToHash, hashToCode, heardBlocks, nextBar } from '../lib/live.mjs';
import { parseBlocks, query } from '../lib/pattern.mjs';

const words = (evs) => evs.map((e) => `${e.block}:${e.sound}@${Number(e.start.toFixed(4))}`);

test('blocks: $name:, name: and $:, _ mutes one, each with the line it starts on', () => {
  const blocks = parseBlocks('// a beat\n$drums: s("bd sd")\n_bass: note("c2").s("bass")\n$: s("hh*2")\nkeys:\n  note("c3")');
  assert.deepEqual(blocks.map(({ name, muted, line }) => [name, muted, line]), [['drums', false, 2], ['bass', true, 3], ['3', false, 4], ['keys', false, 5]]);
  assert.deepEqual(query(blocks[0].pattern, 0, 1).map((e) => e.sound), ['kick', 'snare']);
});

test('each event says where its words are in the code', () => {
  const code = '$a: note("c3 e3").s("<bass lead>")';
  const evs = query(parseBlocks(code)[0].pattern, 0, 2);
  assert.deepEqual(evs.map((e) => e.locs.map(([a, b]) => code.slice(a, b))), [['c3', 'bass'], ['e3', 'bass'], ['c3', 'lead'], ['e3', 'lead']]);
  const deg = '$: n("0 2").scale("C:major")';
  assert.deepEqual(query(parseBlocks(deg)[0].pattern, 0, 1).map((e) => e.locs.map(([a, b]) => deg.slice(a, b))), [['0', 'C:major'], ['2', 'C:major']]);
});

test('mute and solo: a solo wins, a block muted in the code stays muted', () => {
  const blocks = parseBlocks('$a: s("bd")\n$b: s("sd")\n_$c: s("hh")');
  const names = (h) => heardBlocks(blocks, h).map((b) => b.name);
  assert.deepEqual(names(), ['a', 'b']);
  assert.deepEqual(names({ muted: new Set(['a']) }), ['b']);
  assert.deepEqual(names({ soloed: new Set(['b']) }), ['b']);
  assert.deepEqual(names({ soloed: new Set(['c']) }), ['c']);
});

test('new code comes in on the bar line: the bar playing ends as it was', () => {
  const loop = new Loop();
  loop.set(parseBlocks('$a: s("bd*2")'));
  assert.deepEqual(words(loop.events(0, 1)), ['a:kick@0', 'a:kick@0.5']);
  // played up to 1.3: the next code comes in on bar 2 (the third), and the rest of bar 1 is the old code
  loop.advance(1.3);
  const at = nextBar(1.3);
  assert.equal(at, 2);
  loop.set(parseBlocks('$b: s("sd*4")'), at);
  assert.deepEqual(words(loop.events(1.3, 2.6)), ['a:kick@1.5', 'b:snare@2', 'b:snare@2.25', 'b:snare@2.5']);
  // asking changes nothing; playing past the line does
  assert.deepEqual(words(loop.events(1.3, 2.6)), ['a:kick@1.5', 'b:snare@2', 'b:snare@2.25', 'b:snare@2.5']);
  loop.advance(2.6);
  assert.equal(loop.next, null);
  assert.deepEqual(words(loop.events(3, 3.3)), ['b:snare@3', 'b:snare@3.25']);
});

test('nextBar: the next bar line after what is scheduled', () => {
  assert.equal(nextBar(0), 1);
  assert.equal(nextBar(0.99), 1);
  assert.equal(nextBar(3), 4);
  assert.equal(nextBar(3.0000000001), 4);
});

test('the events of muted blocks are not played, and a block can be heard again', () => {
  const loop = new Loop();
  loop.set(parseBlocks('$a: s("bd")\n$b: s("hh")'));
  assert.deepEqual(words(loop.events(0, 1, { muted: new Set(['b']) })), ['a:kick@0']);
  assert.deepEqual(words(loop.events(0, 1)), ['a:kick@0', 'b:hat@0']);
});

test('the code in a link, and back, with its tempo; a link without code is none', () => {
  const code = '$drums: s("bd*4, hh*8?") // ünïcödé, "quotes" & #hash\n$b: note("c3")';
  const hash = codeToHash(code, 128);
  assert.match(hash, /^#bpm=128&code=[A-Za-z0-9_-]+$/);
  assert.deepEqual(hashToCode(hash), { code, bpm: 128 });
  assert.deepEqual(hashToCode(codeToHash('s("bd")', 999)), { code: 's("bd")', bpm: null });
  assert.equal(hashToCode(''), null);
  assert.equal(hashToCode('#bpm=120'), null);
  assert.equal(hashToCode('#code=%%%'), null);
});
