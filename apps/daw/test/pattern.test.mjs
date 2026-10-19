// The pattern language (lib/pattern.mjs): Strudel's mini-notation and its core functions, queried bar by bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatternError, parse, query } from '../lib/pattern.mjs';

// the events of the code between two cycles, as short words: "kick@0.25", "bass48@0.5" (a pitch after the sound)
const at = (t) => String(Number(t.toFixed(4)));
const play = (code, from = 0, to = 1) => query(parse(code), from, to).map((e) => `${e.sound ?? ''}${e.pitch ?? ''}@${at(e.start)}`);
const starts = (code, sound, from = 0, to = 1) => query(parse(code), from, to).filter((e) => e.sound === sound).map((e) => at(e.start));
const fails = (code, line, col, words) => assert.throws(() => parse(code), (err) => {
  assert.ok(err instanceof PatternError, err.message);
  assert.deepEqual([err.line, err.col], [line, col], err.message);
  assert.match(err.reason, words);
  return true;
});

test('the examples of the issue', () => {
  // kick on every beat, snare on 2 and 4, eighth hats
  const beat = 's("bd*4, [~ sd]*2, hh*8")';
  assert.deepEqual(starts(beat, 'kick'), ['0', '0.25', '0.5', '0.75']);
  assert.deepEqual(starts(beat, 'snare'), ['0.25', '0.75']);
  assert.equal(starts(beat, 'hat').length, 8);
  // a Euclidean kick, hats that drop out at random
  assert.deepEqual(starts('s("bd(3,8), hh*8?")', 'kick'), ['0', '0.375', '0.75']);
  assert.ok(starts('s("bd(3,8), hh*8?")', 'hat').length < 8);
  // a different note each half cycle
  assert.deepEqual(play('note("<c3 eb3 g3 bb3>*2").s("bass")', 0, 2), ['bass48@0', 'bass51@0.5', 'bass55@1', 'bass58@1.5']);
  // every fourth cycle twice as fast: the first, the fifth, …
  const ev = 's("bd sd").every(4, fast(2))';
  assert.equal(play(ev, 0, 1).length, 4);
  assert.equal(play(ev, 1, 4).length, 6);
  assert.equal(play(ev, 4, 5).length, 4);
});

test('mini-notation: sequences, rests, groups and layers', () => {
  assert.deepEqual(play('s("bd sd hh")'), ['kick@0', 'snare@0.3333', 'hat@0.6667']);
  assert.deepEqual(play('s("bd ~ sd -")'), ['kick@0', 'snare@0.5']);
  assert.deepEqual(play('s("bd [sd sd]")'), ['kick@0', 'snare@0.5', 'snare@0.75']);
  assert.deepEqual(play('s("bd [sd [hh hh]]")'), ['kick@0', 'snare@0.5', 'hat@0.75', 'hat@0.875']);
  assert.deepEqual(play('s("bd, hh hh")'), ['hat@0', 'kick@0', 'hat@0.5']);
  assert.deepEqual(play('s("[bd, sd] hh")'), ['kick@0', 'snare@0', 'hat@0.5']);
  // an event's length is its slot
  assert.deepEqual(query(parse('s("bd [sd sd]")'), 0, 1).map((e) => e.len), [0.5, 0.25, 0.25]);
});

test('mini-notation: < > plays one item a cycle, and each item counts the cycles it has played', () => {
  assert.deepEqual(play('s("<bd sd>")', 0, 3), ['kick@0', 'snare@1', 'kick@2']);
  assert.deepEqual(play('s("hh <sd cp>")', 0, 2), ['hat@0', 'snare@0.5', 'hat@1', 'clap@1.5']);
  assert.deepEqual(play('s("bd <sd <cp rim>>")', 0, 4).filter((w) => !w.startsWith('kick')), ['snare@0.5', 'clap@1.5', 'snare@2.5', 'rim@3.5']);
  assert.deepEqual(play('s("<bd sd, hh>")', 0, 2), ['hat@0', 'kick@0', 'hat@1', 'snare@1']);
});

test('mini-notation: * / ! _ @ ? and Euclid', () => {
  assert.deepEqual(play('s("bd*2 sd")'), ['kick@0', 'kick@0.25', 'snare@0.5']);
  assert.deepEqual(play('s("bd sd/2")', 0, 2), ['kick@0', 'snare@0.5', 'kick@1']);
  assert.deepEqual(play('s("bd!3 sd")'), ['kick@0', 'kick@0.25', 'kick@0.5', 'snare@0.75']);
  assert.deepEqual(play('s("bd ! sd")'), ['kick@0', 'kick@0.3333', 'snare@0.6667']);
  assert.deepEqual(play('s("bd _ _ sd")'), ['kick@0', 'snare@0.75']);
  assert.deepEqual(play('s("bd@3 sd")'), ['kick@0', 'snare@0.75']);
  assert.deepEqual(play('s("[bd sd]@3 hh")'), ['kick@0', 'snare@0.375', 'hat@0.75']);
  assert.deepEqual(starts('s("bd(5,8)")', 'kick'), ['0', '0.25', '0.375', '0.625', '0.75']);   // x.xx.xx.
  assert.deepEqual(starts('s("bd(3,8,2)")', 'kick'), ['0.125', '0.5', '0.75']);                 // turned left by 2
  assert.deepEqual(play('s("bd?0")'), ['kick@0']);
  assert.deepEqual(play('s("bd?1")'), []);
  // a number that changes by cycle
  assert.deepEqual(starts('s("bd*<2 3>")', 'kick', 0, 2), ['0', '0.5', '1', '1.3333', '1.6667']);
  // a sample number is read, and the kit plays its one sound
  assert.deepEqual(play('s("bd:3 sd")'), ['kick@0', 'snare@0.5']);
});

test('notes: names with octave 3 when none is written, numbers, and scale degrees', () => {
  assert.deepEqual(play('note("c e g b")'), ['48@0', '52@0.25', '55@0.5', '59@0.75']);
  assert.deepEqual(play('note("c#4 eb2 60")'), ['61@0', '39@0.3333', '60@0.6667']);
  assert.deepEqual(play('n("0 2 4 -1").scale("C:major")'), ['48@0', '52@0.25', '55@0.5', '47@0.75']);
  assert.deepEqual(play('n("7").scale("A2:minor")'), ['57@0']);
  assert.deepEqual(play('n("0 1 2").scale("D:minor:pentatonic")'), ['50@0', '53@0.3333', '55@0.6667']);
  assert.deepEqual(play('n("0").scale("<C:major A:minor>")', 0, 2), ['48@0', '57@1']);
  // n alone on a synth: semitones from C3
  assert.deepEqual(play('n("0 7").s("pad")'), ['pad48@0', 'pad55@0.5']);
});

test('functions: fast, slow, rev, ply, off, late and early', () => {
  assert.deepEqual(play('s("bd sd").fast(2)'), ['kick@0', 'snare@0.25', 'kick@0.5', 'snare@0.75']);
  assert.deepEqual(play('s("bd sd").slow(2)', 0, 2), ['kick@0', 'snare@1']);
  assert.deepEqual(play('s("bd sd").fast("<1 2>")', 0, 2), ['kick@0', 'snare@0.5', 'kick@1', 'snare@1.25', 'kick@1.5', 'snare@1.75']);
  assert.deepEqual(play('s("bd sd hh").rev()'), ['hat@0', 'snare@0.3333', 'kick@0.6667']);
  assert.deepEqual(play('s("bd sd").ply(2)'), ['kick@0', 'kick@0.25', 'snare@0.5', 'snare@0.75']);
  assert.deepEqual(play('s("bd sd").off(1/8, x => x.s("hh"))'), ['kick@0', 'hat@0.125', 'snare@0.5', 'hat@0.625']);
  assert.deepEqual(play('s("bd sd").late(0.25)'), ['kick@0.25', 'snare@0.75']);
  assert.deepEqual(play('s("bd sd").early(0.25)'), ['snare@0.25', 'kick@0.75']);
});

test('every: the function on the first cycle of each n, written three ways', () => {
  for (const code of ['s("bd sd").every(3, fast(2))', 's("bd sd").every(3, x => x.fast(2))', 's("bd sd").every(3, (p) => p.fast(2))', 'every(3, fast(2), s("bd sd"))']) {
    assert.deepEqual([0, 1, 2, 3].map((c) => play(code, c, c + 1).length), [4, 2, 2, 4], code);
  }
  assert.deepEqual(play('s("bd sd hh").every(2, rev)'), ['hat@0', 'snare@0.3333', 'kick@0.6667']);
});

test('stack, cat and seq, and patterns on lines of their own', () => {
  assert.deepEqual(play('stack(s("bd*2"), note("c3 e3").s("pad"))'), ['kick@0', 'pad48@0', 'kick@0.5', 'pad52@0.5']);
  assert.deepEqual(play('cat(s("bd"), s("sd sd"))', 0, 2), ['kick@0', 'snare@1', 'snare@1.5']);
  assert.deepEqual(play('seq(s("bd"), s("sd sd"))'), ['kick@0', 'snare@0.5', 'snare@0.75']);
  assert.deepEqual(play('stack("bd hh", "sd")'), ['kick@0', 'snare@0', 'hat@0.5']);
  // each line a pattern, a chain may go on over lines, // comments, and _$: mutes one
  const code = '// the beat\n$: s("bd sd")\n  .fast(2)\n$: s("hh*2")\n_$: s("cp*16")';
  assert.deepEqual(play(code), ['hat@0', 'kick@0', 'snare@0.25', 'hat@0.5', 'kick@0.5', 'snare@0.75']);
  assert.deepEqual(play(''), []);
});

test('gain and velocity scale the normal level, 0.8', () => {
  const vels = (code) => query(parse(code), 0, 1).map((e) => Number(e.vel.toFixed(3)));
  assert.deepEqual(vels('s("hh*4").gain("[.5 1]*2")'), [0.4, 0.8, 0.4, 0.8]);
  assert.deepEqual(vels('s("hh").gain(2)'), [1]);
  assert.deepEqual(vels('s("hh").velocity(0.5)'), [0.4]);
});

test('randomness: the same code gives the same bars every time, and different bars from cycle to cycle', () => {
  for (const code of ['s("hh*16?")', 's("hh*16").degradeBy(0.3)', 's("hh*8").sometimes(x => x.ply(2))', 's("hh*16").rarely(fast(2))']) {
    const bars = (from) => play(code, from, from + 1).map((w) => at(Number(w.split('@')[1]) - from));
    assert.deepEqual(bars(0), bars(0), code);
    assert.deepEqual(query(parse(code), 0, 8), query(parse(code), 0, 8), code);
    assert.ok([1, 2, 3, 4, 5, 6, 7].some((c) => JSON.stringify(bars(c)) !== JSON.stringify(bars(0))), `${code} is the same every cycle`);
  }
  // about half of the hats with ?, none with degradeBy(1), all with degradeBy(0)
  const kept = query(parse('s("hh*16?")'), 0, 16).length;
  assert.ok(kept > 96 && kept < 160, `${kept} of 256`);
  assert.equal(play('s("hh*16").degradeBy(1)').length, 0);
  assert.equal(play('s("hh*16").degradeBy(0)').length, 16);
});

test('a query from the middle of a cycle: only what starts in it', () => {
  assert.deepEqual(play('s("bd sd hh cp")', 0.4, 1.3), ['hat@0.5', 'clap@0.75', 'kick@1', 'snare@1.25']);
  assert.deepEqual(starts('s("bd sd hh cp")', 'kick', 0.4, 2.1), ['1', '2']);
  assert.deepEqual(play('s("bd sd hh cp")', 0.5, 0.75), ['hat@0.5']);
  assert.deepEqual(play('s("bd(3,8)")', 0.3, 0.8), ['kick@0.375', 'kick@0.75']);
});

// From the Strudel workshop (strudel.cc/workshop) and the Tidal documentation (tidalcycles.org), those that use only
// what this supports.
test('tutorial examples', () => {
  // Strudel, first sounds
  assert.deepEqual(play('sound("bd hh sd oh")'), ['kick@0', 'hat@0.25', 'snare@0.5', 'open@0.75']);
  assert.deepEqual(play('sound("bd*2, hh sd")'), ['hat@0', 'kick@0', 'kick@0.5', 'snare@0.5']);
  assert.deepEqual(play('sound("bd [hh hh] sd [hh bd]")'), ['kick@0', 'hat@0.25', 'hat@0.375', 'snare@0.5', 'hat@0.75', 'kick@0.875']);
  assert.deepEqual(play('sound("<bd bd hh bd rim bd hh bd>*8")'), ['kick@0', 'kick@0.125', 'hat@0.25', 'kick@0.375', 'rim@0.5', 'kick@0.625', 'hat@0.75', 'kick@0.875']);
  assert.deepEqual(play('sound("bd sd, hh*4").slow(2)', 0, 2), ['hat@0', 'kick@0', 'hat@0.5', 'hat@1', 'snare@1', 'hat@1.5']);
  // Strudel, first notes: chords in a sequence, an alternation of chords
  assert.deepEqual(play('note("<[c3,e3,g3] [a2,c3,e3]>")', 0, 2), ['48@0', '52@0', '55@0', '45@1', '48@1', '52@1']);
  assert.deepEqual(play('n("0 2 4 <[6,8] [7,9]>").scale("C:minor")', 0, 1), ['48@0', '51@0.25', '55@0.5', '58@0.75', '62@0.75']);
  assert.deepEqual(play('note("c2 <eb2 <g2 g1>>")', 0, 4).filter((w) => !w.startsWith('36@')), ['39@0.5', '43@1.5', '39@2.5', '31@3.5']);
  // Tidal, mini-notation
  assert.deepEqual(play('s("bd*2 [sd cp]")'), ['kick@0', 'kick@0.25', 'snare@0.5', 'clap@0.75']);
  assert.deepEqual(play('s("[bd bd] [sd sd sd]")'), ['kick@0', 'kick@0.25', 'snare@0.5', 'snare@0.6667', 'snare@0.8333']);
  assert.deepEqual(starts('s("bd(5,8,2)")', 'kick'), ['0', '0.125', '0.375', '0.5', '0.75']);
  assert.deepEqual(play('s("bd*2 <sd cp>")', 0, 2), ['kick@0', 'kick@0.25', 'snare@0.5', 'kick@1', 'kick@1.25', 'clap@1.5']);
});

test('errors say the line, the column and what was expected', () => {
  fails('s("bd sx")', 1, 7, /no sound called "sx"/);
  fails('s("bd [sd")', 1, 10, /"\]" expected/);
  fails('s("bd sd>")', 1, 9, /unexpected ">"/);
  fails('s("bd sd").fats(2)', 1, 12, /unknown function "\.fats"/);
  fails('note("c3 h3")', 1, 10, /"h3" is not a note/);
  fails('s("bd sd")\n  .every(4)', 2, 4, /every takes 2 arguments/);
  fails('s("bd(3)")', 1, 8, /"," expected/);
  fails('s("bd(9,8)")', 1, 6, /between 0 and the steps/);
  fails("s('bd'", 1, 7, /"\)" expected/);
  fails('s("bd sd").fast("x")', 1, 18, /"x" is not a number/);
  fails('s("bd").every(4, 2)', 1, 18, /every needs a function/);
  fails('s("bd") s("sd"', 1, 15, /"\)" expected/);
  fails('nope("bd")', 1, 1, /unknown function "nope"/);
  fails('s("bd").gain("loud")', 1, 15, /"loud" is not a number/);
  fails('s("bd sd"', 1, 10, /"\)" expected/);
  fails('s("! bd")', 1, 4, /"!" repeats the step before/);
});
