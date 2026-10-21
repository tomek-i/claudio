// The examples: a loop in each of a few styles, to start from or to learn the language by (the Examples menu on the
// page). The first is what a first visit opens with, and what the banner's strip draws (lib/banner.mjs). Each one
// is only the language of PATTERNS.md, on the kit and the five synth sounds; test/examples.test.mjs plays them all.
export const EXAMPLES = [
  {
    id: 'starter', name: 'Starter', bpm: 120,
    code: `// Ctrl+Enter plays, and plays your changes from the next bar. Ctrl+. stops.
$drums: s("bd*4, [~ sd]*2, hh*8?")
$bass: n("0 0 3 <5 7>").scale("C2:minor").s("bass").every(4, rev)
$chords: note("<[c3,eb3,g3] [ab2,c3,eb3]>").s("pad")
`,
  },
  {
    id: 'techno', name: 'Techno', bpm: 132,
    code: `// Techno: a kick on every beat, open hats between them, a bass that rolls on the sixteenths.
$kick: s("bd*4")
$hats: s("[~ oh]*4, hh*16?0.3").gain("[.5 .8]*8")
$clap: s("~ cp ~ cp").every(4, x => x.ply(2))
$perc: s("rim(5,16,2)").gain(0.6)
$bass: note("[~ a1 a1 a1]*4").s("bass").every(2, x => x.late(1/16))
$stab: note("<[a3,c4,e4] ~ [g3,c4,e4] ~>").s("pluck").off(3/16, x => x.gain(0.4))
`,
  },
  {
    id: 'house', name: 'House', bpm: 124,
    code: `// House: four to the floor, offbeat keys and bass, a pluck that answers itself.
$drums: s("bd*4, [~ oh]*4, ~ cp ~ cp, hh*16?0.5")
$keys: note("[~ <[f3,a3,c4,e4] [g3,b3,d4] [e3,g3,c4] [a3,c4,e4]>]*2").s("keys")
$bass: note("[~ <f2 g2 c2 a1>]*4").s("bass")
$lead: n("0 2 4 [7 4] ~ 4 2 ~").scale("C4:major").s("pluck").every(2, rev).gain(0.6)
`,
  },
  {
    id: 'hiphop', name: 'Hip-hop', bpm: 90,
    code: `// Boom bap: a lazy kick, a hard snare on 2 and 4, Rhodes-ish chords and a walking bass.
$kick: s("bd ~ ~ [~ bd] ~ [~ bd] bd ~")
$snare: s("~ sd ~ sd")
$hats: s("hh*8").gain("[1 .5]*4").sometimesBy(0.2, x => x.ply(2))
$keys: note("<[d3,f3,a3,c4] [g2,bb2,d3,f3]>").s("keys")
$bass: note("<[d2 ~ ~ d2 ~ ~ a1 ~] [g1 ~ ~ g1 ~ bb1 c2 ~]>").s("bass")
`,
  },
  {
    id: 'trap', name: 'Trap', bpm: 140,
    code: `// Trap: half time, hats that roll, a long 808 under it ($sub) and a dark pluck.
$kick: s("bd ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~")
$clap: s("~ cp")
$hats: s("hh*8").sometimesBy(0.35, x => x.ply(3))
$sub: note("c2 ~ ~ ~ ~ ~ c2 ~ ~ ~ eb2 ~ ~ ~ g1 ~").s("bass")
$lead: n("~ 0 2 ~ 4 ~ 3 2").scale("C4:minor").s("pluck").slow(2).gain(0.6)
`,
  },
  {
    id: 'dnb', name: 'Drum & bass', bpm: 172,
    code: `// Drum & bass: the two-step break, a bass held under it, a pad and a few notes on top.
$break: s("bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~, ~ sd ~ sd, hh*8, [~ ~ ~ sd?0.4]*2").gain("[1 .8]*4")
$bass: note("<f1 f1 ab1 [eb1 db1]>").s("bass")
$pad: note("<[f3,ab3,c4] [db3,f3,ab3]>").s("pad").slow(2)
$lead: n("0 ~ 4 ~ 7 ~ 4 5").scale("F4:minor").s("pluck").rarely(x => x.ply(2)).gain(0.5)
`,
  },
];

export const EXAMPLE = EXAMPLES[0].code;
