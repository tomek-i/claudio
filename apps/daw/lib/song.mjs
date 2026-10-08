// What sounds when. eventsInWindow() answers "which drum hits and notes start in this stretch of the song", and
// playback, the WAV export and the MIDI export all ask it, which is why they agree. The Playhead walks the song
// for live playback: it follows the loop and the tempo and says at which second each event sounds.
//
// Positions are in steps (sixteenths) from the start of the song; times are in seconds.
import { STEPS_PER_BAR } from './project.mjs';
import { VOICES } from './kit.mjs';

export const stepSeconds = (bpm) => 60 / bpm / 4;

export const songSteps = (project) => project.bars * STEPS_PER_BAR;

// swing 0..1: how late the off sixteenths (2nd, 4th, …) are, as a share of half a step. Notes between the steps are not moved.
export const swingSteps = (pos, swing) => (Number.isInteger(pos) && pos % 2 ? (swing || 0) * 0.5 : 0);

// the tracks that are heard: the soloed ones when any is soloed, otherwise the ones that are not muted
export function audibleTracks(project) {
  const solo = project.tracks.some((t) => t.solo);
  return project.tracks.filter((t) => (solo ? t.solo : !t.mute));
}

// Every event that starts in [from, to), in the order they sound:
//   { track, kind: 'drums', voice, pos, vel }   { track, kind: 'synth', preset, pitch, pos, len, vel }
// A clip's content repeats until the clip ends, and a note is cut off where its clip ends. Muted tracks are in
// here too: who is heard is the mixer's business (audibleTracks).
export function eventsInWindow(project, from, to) {
  const events = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const start = clip.bar * STEPS_PER_BAR;
      const end = start + clip.bars * STEPS_PER_BAR;
      const content = clip.len * STEPS_PER_BAR;
      if (end <= from - 1 || start >= to) continue;       // − 1: a swung hit sounds up to half a step after its step
      const add = (at, event) => {
        const pos = at + swingSteps(at, project.swing);
        if (at < end && pos >= from && pos < to) events.push({ track: track.id, kind: track.kind, ...event, pos });
      };
      for (let base = start + Math.max(0, Math.floor((from - 1 - start) / content)) * content; base < Math.min(end, to); base += content) {
        if (track.kind === 'drums') {
          for (const voice of VOICES) {
            clip.rows[voice.id].forEach((vel, step) => { if (vel > 0) add(base + step, { voice: voice.id, vel }); });
          }
        } else {
          for (const n of clip.notes) add(base + n.start, { preset: track.preset, pitch: n.pitch, len: Math.min(n.len, end - base - n.start), vel: n.vel });
        }
      }
    }
  }
  return events.sort((a, b) => a.pos - b.pos);
}

// Where playback is. advance() hands out everything that sounds before a moment on the audio clock, each event
// with its `time`, and remembers how far it got; position() says where the playhead is at a moment. With the
// loop on, the end of the loop leads back to its start; without it, the song ends (`done`, at `time`).
export class Playhead {
  constructor(project, pos, time) {
    this.pos = pos;                                  // everything before this position has been handed out
    this.time = time;                                // the second at which `pos` sounds
    this.done = false;
    this.marks = [{ time, pos, step: stepSeconds(project.bpm) }];   // where the playhead was put, and how fast it runs from there
  }

  mark(step) {
    this.marks.push({ time: this.time, pos: this.pos, step });
    if (this.marks.length > 8) this.marks.shift();
  }

  advance(project, until) {
    const out = [];
    const step = stepSeconds(project.bpm);
    if (step !== this.marks.at(-1).step) this.mark(step);            // a new tempo takes over from where the playhead has got to
    const end = songSteps(project);
    const loopEnd = project.loop.on ? project.loop.to * STEPS_PER_BAR : 0;
    for (let turns = 0; this.time < until && !this.done && turns < 64; turns++) {
      const wall = this.pos < loopEnd ? loopEnd : end;               // started after the loop: play on to the end of the song
      if (this.pos >= wall) { this.done = true; break; }
      const reach = this.pos + (until - this.time) / step;
      const to = Math.min(wall, reach);
      for (const event of eventsInWindow(project, this.pos, to)) out.push({ ...event, time: this.time + (event.pos - this.pos) * step });
      this.time = reach < wall ? until : this.time + (wall - this.pos) * step;
      this.pos = to;
      if (to === loopEnd) { this.pos = project.loop.from * STEPS_PER_BAR; this.mark(step); }
    }
    return out;
  }

  position(now) {
    const mark = this.marks.findLast((m) => m.time <= now) || this.marks[0];
    return mark.pos + Math.max(0, now - mark.time) / mark.step;
  }
}
