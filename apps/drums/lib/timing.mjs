// When a hit sounds. A step grid alone puts every hit on a sixteenth; the groove is in how far each one sits off
// it. So a hit's place is three things added together: its step, the swing (every second step late), and its own
// offset. Playback, the WAV export and the MIDI export all ask this file, which is why they agree.
//
// Positions are in steps (sixteenths) from the start of the loop; times are in seconds.

export const MAX_EARLY = 0.4;   // a hit is never more than this much of a step ahead of its step
export const MAX_LATE = 0.5;

export const stepSeconds = (bpm) => 60 / bpm / 4;

export const clampOffset = (off) => Math.min(MAX_LATE, Math.max(-MAX_EARLY, off || 0));

// swing 0..1: how late the off steps (2nd, 4th, …) are, as a share of half a step. 0.5 at 90 BPM is 41.7 ms.
export const swingSteps = (step, swing) => (step % 2 ? (swing || 0) * 0.5 : 0);

export const swingDelay = (step, swing, bpm) => swingSteps(step, swing) * stepSeconds(bpm);

export const hitPos = (step, swing, off) => step + swingSteps(step, swing) + clampOffset(off);

export const hitTime = (step, { bpm, swing }, off) => hitPos(step, swing, off) * stepSeconds(bpm);

// The grid's own marks, which no swing or offset moves: a beat is four steps and a bar four beats. A step is
// named bar.beat by the beat it is in ("1.3" for steps 9 to 12, "2.1" for the first of the second bar).
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;

export const beatName = (step) => `${Math.floor(step / STEPS_PER_BAR) + 1}.${Math.floor((step % STEPS_PER_BAR) / STEPS_PER_BEAT) + 1}`;

// the step each beat of a pattern starts on: 0, 4, 8, … (counted from 0, as everywhere in the code)
export const beatSteps = (steps) => Array.from({ length: Math.ceil(steps / STEPS_PER_BEAT) }, (_, i) => i * STEPS_PER_BEAT);

// the rows that are heard: the soloed ones when any is soloed, otherwise the ones that are not muted
export function audibleTracks(pattern) {
  const solo = pattern.tracks.some((t) => t.solo);
  return pattern.tracks.filter((t) => (solo ? t.solo : !t.mute));
}

// Every hit whose position is in [from, to), with the loop repeating for ever (or up to and including loop
// `lastLoop`). A hit pulled ahead of step 1 belongs to the end of the loop before, which is where it is found.
// `firstStep` is the step playback started on (counted from the start of the first loop): the steps before it
// are not played, so a late hit of the step before does not sound when the beat is started in the middle.
export function hitsInWindow(pattern, from, to, { lastLoop = Infinity, firstStep = 0 } = {}) {
  const len = pattern.steps;
  const hits = [];
  const first = Math.max(0, Math.floor((from - MAX_LATE - 0.5) / len));
  const last = Math.min(lastLoop, Math.floor((to + MAX_EARLY) / len));
  for (const track of audibleTracks(pattern)) {
    for (let loop = first; loop <= last; loop++) {
      for (let step = 0; step < len; step++) {
        const vel = track.vel[step];
        if (!(vel > 0) || loop * len + step < firstStep) continue;
        const pos = loop * len + hitPos(step, pattern.swing, track.off[step]);
        if (pos >= from && pos < to) hits.push({ voice: track.voice, pos, step, vel, level: track.level, tune: track.tune });
      }
    }
  }
  return hits.sort((a, b) => a.pos - b.pos);
}
