// The song as text, for the terminal: the arrangement (tracks down, bars across, clips as blocks) and one clip
// (drum rows, or notes and a small piano roll). This is what Claude reads, so it is compact and says the ids.
import { STEPS_PER_BAR, findClip } from './project.mjs';
import { VOICES, letterOf } from './kit.mjs';
import { formatNotes, noteName } from './notes.mjs';

const pct = (n) => Math.round(n * 100);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const range = (clip) => (clip.bars === 1 ? `${clip.bar + 1}` : `${clip.bar + 1}-${clip.bar + clip.bars}`);

// what a clip holds, without the ids: two clips with the same content are copies of each other
const contentKey = (clip) => JSON.stringify([clip.len, clip.rows || clip.notes.map((n) => [n.pitch, n.start, n.len, n.vel])]);

function contentText(clip) {
  const count = clip.rows ? plural(Object.values(clip.rows).flat().filter((v) => v > 0).length, 'hit') : plural(clip.notes.length, 'note');
  if (count.startsWith('0 ')) return 'empty';
  const times = Number((clip.bars / clip.len).toFixed(2));
  const shape = clip.bars > clip.len ? `${plural(clip.len, 'bar')} ×${times}, ` : clip.bars < clip.len ? `first ${clip.bars} of ${clip.len} bars, ` : '';
  return shape + count;
}

function mixText(t) {
  const pan = Math.round(t.pan * 100);
  return [`vol ${pct(t.vol)}`, pan && `pan ${pan < 0 ? 'L' : 'R'}${Math.abs(pan)}`, t.reverb && `reverb ${pct(t.reverb)}`, t.delay && `delay ${pct(t.delay)}`, t.mute && 'muted', t.solo && 'solo'].filter(Boolean).join('  ');
}

// one character per bar: . nothing, # a clip of one bar, [==] a longer one
function lane(track, bars) {
  const chars = Array(bars).fill('.');
  for (const c of track.clips) for (let i = 0; i < c.bars; i++) chars[c.bar + i] = c.bars === 1 ? '#' : i === 0 ? '[' : i === c.bars - 1 ? ']' : '=';
  return chars.join('');
}

function ruler(bars) {
  const chars = Array(bars).fill(' ');
  for (let b = 0; b < bars; b += 4) {
    const label = String(b + 1);
    if (b + label.length <= bars) [...label].forEach((ch, i) => { chars[b + i] = ch; });
  }
  return chars.join('').trimEnd();
}

export function arrangementText(project) {
  const p = project;
  const lines = [`"${p.name}"  ${p.bpm} bpm  swing ${pct(p.swing)}%  ${plural(p.bars, 'bar')}  loop ${p.loop.from + 1}-${p.loop.to} ${p.loop.on ? 'on' : 'off'}  master ${pct(p.master)}`];
  if (!p.tracks.length) return `${lines[0]}\n(no tracks yet: track add drums|synth [name] [sound])`;
  const labels = p.tracks.map((t) => `${t.id} ${t.name}  ${t.kind === 'drums' ? 'drums' : t.preset}`);
  const pad = Math.max(...labels.map((l) => l.length)) + 2;
  lines.push(`${'bar'.padEnd(pad)}${ruler(p.bars)}`);
  const first = new Map();                          // content → the first clip that has it
  p.tracks.forEach((t, i) => {
    lines.push(`${labels[i].padEnd(pad)}${lane(t, p.bars)}   ${mixText(t)}`);
    const clips = t.clips.map((c) => {
      const key = t.kind + contentKey(c);
      const twin = first.get(key);
      if (!twin) first.set(key, c.id);
      return `${c.id} ${range(c)} (${twin && contentText(c) !== 'empty' ? `=${twin}` : contentText(c)})`;
    });
    lines.push(`    ${clips.length ? clips.join(' · ') : '(no clips: clip add ' + t.id + ' <bar> <bars>)'}`);
  });
  return lines.join('\n');
}

const stepRuler = (bars) => Array.from({ length: bars * STEPS_PER_BAR }, (_, s) => (s % 4 ? '.' : (s / 4) % 4 + 1)).join('');

export function clipText(project, id) {
  const found = findClip(project, String(id).toLowerCase());
  if (!found) throw new Error(`no clip "${id}" (clips are named c1, c2, …; the arrangement lists them)`);
  const { track, clip } = found;
  const lines = [`${clip.id}  ${track.id} ${track.name} (${track.kind === 'drums' ? 'drums' : track.preset})  ${clip.bars === 1 ? 'bar' : 'bars'} ${range(clip)}  ${contentText(clip)}`];
  if (track.kind === 'drums') {
    const pad = Math.max(...VOICES.map((v) => v.id.length)) + 2;
    lines.push(' '.repeat(pad) + stepRuler(clip.len));
    const rows = VOICES.filter((v) => clip.rows[v.id].some((vel) => vel > 0));
    for (const v of rows) lines.push(v.id.padEnd(pad) + clip.rows[v.id].map(letterOf).join(''));
    if (!rows.length) lines.push('(no hits: drums ' + clip.id + ' "kick x...x...x...x...")');
    return lines.join('\n');
  }
  if (!clip.notes.length) return `${lines[0]}\n(no notes: notes ${clip.id} "C2:0:4 E2:4:2" = pitch:start:length in sixteenths, ${clip.len * STEPS_PER_BAR} in this clip)`;
  for (let bar = 0; bar < clip.len; bar++) {
    const notes = clip.notes.filter((n) => Math.floor(n.start / STEPS_PER_BAR) === bar);
    lines.push(`bar ${bar + 1} (from ${bar * STEPS_PER_BAR}): ${notes.length ? formatNotes(notes) : '-'}`);
  }
  const pitches = [...new Set(clip.notes.map((n) => n.pitch))].sort((a, b) => b - a);
  const pad = Math.max(...pitches.map((p) => noteName(p).length)) + 2;
  lines.push(' '.repeat(pad) + stepRuler(clip.len));
  for (const pitch of pitches) {                    // # where a note starts, = while it is held
    const chars = Array(clip.len * STEPS_PER_BAR).fill('.');
    for (const n of clip.notes.filter((other) => other.pitch === pitch)) {
      const from = Math.floor(n.start);
      for (let s = from; s < Math.max(from + 1, Math.ceil(n.start + n.len - 0.001)) && s < chars.length; s++) chars[s] = s === from ? '#' : '=';
    }
    lines.push(noteName(pitch).padEnd(pad) + chars.join(''));
  }
  return lines.join('\n');
}
