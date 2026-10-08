#!/usr/bin/env node
// The DAW from the terminal: `node claudebase.mjs help`. This is how Claude composes in it: read the arrangement and
// the clips as text, add tracks and clips, write drum rows and notes. It talks to the server (server.mjs) and
// starts it when it is not running. Bars and drum steps count from 1 here; a note's start counts sixteenths from 0.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, findClip, trackOf } from './lib/project.mjs';
import { LEVELS, VOICE_IDS } from './lib/kit.mjs';
import { PRESETS, PRESET_IDS } from './lib/presets.mjs';
import { noteName, noteNumber } from './lib/notes.mjs';
import { arrangementText, clipText } from './lib/text.mjs';
import { ANIMATIONS, animate } from './lib/banner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CLAUDEBASE_PORT) || 4750;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `http://localhost:${PORT}`;

const HELP = `${APP_NAME} — ${PAGE}

  show [--json]                    the arrangement: tracks down, bars across ( . empty, # a one-bar clip, [==] a longer one )
  show clip <id>                   one clip: its drum rows, or its notes and a small piano roll
  open                             start the server if needed and print the address
  banner [name | --list]           preview the server's startup animations (CLAUDEBASE_BANNER=<name> picks one)

 the song
  new [template]                   a new song from a template (no name: list them)
  name <text>   tempo <40-240>   swing <0-100>   length <bars>   master <0-100>
  loop <from> <to> | on | off      the bars that repeat while playing: loop 5 8

 tracks  (a track is named by its id t2, its number 2, or its name)
  track add drums [name]           a drum track (the kit: ${VOICE_IDS.join(' ')})
  track add synth [name] [sound]   a synth track (the sounds: ${PRESET_IDS.join(' ')})
  track name <track> <name>   track sound <track> <sound>   track del <track>
  mix <track> vol|reverb|delay <0-100>   mix <track> pan <L50|C|R50>   mix <track> mute|solo [off]

 clips  (a clip starts at a bar and lasts some bars; its content repeats until it ends)
  clip add <track> <bar> <bars> ["<row>" … | "<notes>"]    a new clip, written at once when rows or notes follow
  clip move <id> <bar> [track]     clip dup <id> [bar] [times]     clip del <id>
  clip resize <id> <bars>          its length on the timeline
  clip len <id> <bars>             the length of its content (1-8 bars; longer repeats what is there)
  clip clear <id>

 writing a drum clip  ( . off, g ghost, o soft, x normal, X accent; 16 steps to the bar )
  drums <clip> [--clear] "<row>" …   whole rows: drums c1 "kick x...x...x...x..." "snare ....X.......X..."
                                   (--clear empties the rows not named; a 32-step row makes the content 2 bars)
  hit <clip> <drum> <step> [level] one step: ghost | soft | normal | accent | off

 writing a synth clip  ( pitch:start:length in sixteenths, start from 0; a 4th part is the velocity 1-127 )
  notes <clip> "<notes>"           replaces the notes: notes c2 "C2:0:4 E2:4:2 G2:8:8"   chords: "A3+C4+E4:0:16"
  notes <clip> --add "<notes>"     adds to them (a note on the same pitch and start is replaced)
  notes <clip> --del <pitch:start> …   removes notes: notes c2 --del C2:0 E2:4

 playing and files
  play [bar]   stop                on the open page (it is the sound, once "Start sound" is clicked on it)
  undo   redo
  export midi <file>               every track in one MIDI file (WAV export is the button on the page)

 the note box on the page
  wait [seconds]                   wait for a note typed on the page (at most 60 s)
  say <text>                       answer on the page`;

async function up() {
  try { return (await fetch(`${BASE}/api/state`)).ok; } catch { return false; }
}

async function ensureServer() {
  if (await up()) return;
  spawn(process.execPath, [path.join(HERE, 'server.mjs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await up()) return;
  }
  throw new Error(`the server did not start (try: node ${path.relative(process.cwd(), path.join(HERE, 'server.mjs'))})`);
}

async function call(method, route, body) {
  const res = await fetch(BASE + route, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

const edit = (op) => call('POST', '/api/op', op);
const show = (state) => console.log(arrangementText(state.project));
const showClip = (state, id) => console.log(clipText(state.project, id));

const need = (value, what) => {
  if (value === undefined) throw new Error(`missing: ${what} (see: claudebase help)`);
  return value;
};
const number = (text, what) => {
  const n = Number(need(text, what));
  if (!Number.isFinite(n) || String(text).trim() === '') throw new Error(`"${text}" is not ${what}`);
  return n;
};
const percent = (text, what) => number(text, what) / 100;
const barArg = (text) => {
  const n = number(text, 'a bar');
  if (!Number.isInteger(n) || n < 1) throw new Error(`"${text}" is not a bar (bars count from 1)`);
  return n - 1;
};
const onOff = (text) => !['off', '0', 'false', 'no'].includes(String(text ?? 'on').toLowerCase());
const lines = (args) => args.flatMap((a) => a.split('\n')).filter((l) => l.trim());

function panArg(text) {
  const m = /^([LR])\s*(\d+)$/i.exec(String(need(text, 'a pan position')).trim());
  if (m) return (m[1].toUpperCase() === 'L' ? -1 : 1) * Number(m[2]) / 100;
  if (/^c(entre|enter)?$/i.test(text)) return 0;
  return percent(text, 'a pan position (L50, C, R50, or -100 to 100)');
}

async function trackCommand([sub, ...args]) {
  switch (sub) {
    case 'add': {
      const kind = need(args[0], 'drums or synth');
      const sound = kind === 'synth' && args.length > 1 && PRESETS[args.at(-1).toLowerCase()] ? args.at(-1).toLowerCase() : undefined;
      const name = args.slice(1, sound ? -1 : undefined).join(' ') || undefined;
      return show(await edit({ op: 'track.add', kind, name, preset: sound }));
    }
    case 'del': return show(await edit({ op: 'track.del', track: need(args[0], 'a track') }));
    case 'name': return show(await edit({ op: 'track.set', track: need(args[0], 'a track'), key: 'name', value: need(args[1], 'a name') && args.slice(1).join(' ') }));
    case 'sound':
    case 'preset': return show(await edit({ op: 'track.set', track: need(args[0], 'a track'), key: 'preset', value: need(args[1], `a sound (${PRESET_IDS.join(', ')})`) }));
    default: throw new Error('track add drums|synth [name] [sound] | track name|sound|del <track> …');
  }
}

async function clipCommand([sub, ...args]) {
  const id = () => need(args[0], 'a clip (c1, c2, …)');
  switch (sub) {
    case 'add': {
      const before = await call('GET', '/api/state');
      const track = trackOf(before.project, need(args[0], 'a track'));
      const clip = `c${before.project.ids.c + 1}`;   // the id the new clip will get
      const content = lines(args.slice(3));
      const ops = [{ op: 'clip.add', track: track.id, bar: barArg(args[1]), bars: number(args[2], 'a length in bars') }];
      if (content.length) ops.push(track.kind === 'drums' ? { op: 'clip.rows', clip, lines: content } : { op: 'clip.notes', clip, notes: content.join(' ') });
      return showClip(await edit({ op: 'batch', ops }), clip);   // one undo step, and nothing is added when the content is refused
    }
    case 'move': return show(await edit({ op: 'clip.move', clip: id(), bar: barArg(args[1]), track: args[2] }));
    case 'dup': return show(await edit({ op: 'clip.dup', clip: id(), bar: args[1] === undefined ? undefined : barArg(args[1]), times: args[2] === undefined ? 1 : number(args[2], 'a number of copies') }));
    case 'resize': return show(await edit({ op: 'clip.resize', clip: id(), bars: number(args[1], 'a length in bars') }));
    case 'len': return showClip(await edit({ op: 'clip.len', clip: id(), len: number(args[1], 'a length in bars') }), id());
    case 'clear': return showClip(await edit({ op: 'clip.clear', clip: id() }), id());
    case 'del': return show(await edit({ op: 'clip.del', clip: id() }));
    default: throw new Error('clip add|move|dup|resize|len|clear|del … (see: claudebase help)');
  }
}

async function notesCommand([clip, ...args]) {
  need(clip, 'a clip (c1, c2, …)');
  const text = args.filter((a) => !a.startsWith('--')).join(' ');
  if (!args.includes('--del')) return showClip(await edit({ op: 'clip.notes', clip, notes: text, add: args.includes('--add') }), clip);
  const state = await call('GET', '/api/state');
  const found = findClip(state.project, clip.toLowerCase());
  if (!found?.clip.notes) throw new Error(`no synth clip "${clip}"`);
  const ops = [];                                    // the notes named, removed in one undo step
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const [pitch, start] = token.split(':');
    const note = found.clip.notes.find((n) => n.pitch === noteNumber(pitch) && n.start === Number(start));
    if (!note) throw new Error(`there is no ${pitch} at ${start} in ${found.clip.id} (name a note as pitch:start, like ${found.clip.notes[0] ? `${noteName(found.clip.notes[0].pitch)}:${found.clip.notes[0].start}` : 'C2:0'})`);
    ops.push({ op: 'note.del', clip, note: note.id });
  }
  if (!ops.length) throw new Error('name the notes to remove as pitch:start (notes c2 --del C2:0 E2:4)');
  return showClip(await edit({ op: 'batch', ops }), clip);
}

async function previewBanner(name) {
  const names = Object.keys(ANIMATIONS);
  if (name === '--list') return console.log(names.join('\n'));
  if (name && !ANIMATIONS[name]) throw new Error(`no animation "${name}" (there are: ${names.join(', ')})`);
  if (!process.stdout.isTTY) throw new Error('the banner draws in place, so it needs a terminal (not a pipe or a file)');
  const play = name ? [name] : names;
  for (const [i, n] of play.entries()) {
    console.log(`\n  ${n}${play.length > 1 ? `  (${i + 1}/${play.length})` : ''}   CLAUDEBASE_BANNER=${n} starts the server with this one`);
    await animate(ANIMATIONS[n]);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main([cmd = 'help', ...args]) {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return console.log(HELP);
  if (cmd === 'banner') return previewBanner(args[0]);
  await ensureServer();
  switch (cmd) {
    case 'open': return console.log(PAGE);
    case 'show': {
      const state = await call('GET', '/api/state');
      if (args[0] === 'clip') return showClip(state, need(args[1], 'a clip (c1, c2, …)'));
      return args.includes('--json') ? console.log(JSON.stringify(state.project)) : show(state);
    }
    case 'new': {
      if (!args.length) return console.log((await call('GET', '/api/state')).templates.join('\n'));
      return show(await edit({ op: 'template', name: args.join(' ') }));
    }
    case 'name': return show(await edit({ op: 'set', key: 'name', value: need(args[0], 'a name') && args.join(' ') }));
    case 'tempo':
    case 'bpm': return show(await edit({ op: 'set', key: 'bpm', value: number(args[0], 'a tempo') }));
    case 'swing': return show(await edit({ op: 'set', key: 'swing', value: percent(args[0], 'a swing amount') }));
    case 'master': return show(await edit({ op: 'set', key: 'master', value: percent(args[0], 'a level') }));
    case 'length':
    case 'bars': return show(await edit({ op: 'set', key: 'bars', value: number(args[0], 'a number of bars') }));
    case 'loop': {
      if (/^(on|off)$/i.test(need(args[0], 'two bars, or on, or off'))) return show(await edit({ op: 'loop', on: onOff(args[0]) }));
      return show(await edit({ op: 'loop', from: barArg(args[0]), to: barArg(need(args[1], 'the last bar of the loop')) + 1, on: true }));
    }
    case 'track': return trackCommand(args);
    case 'mix': {
      const track = need(args[0], 'a track');
      const key = need(args[1], 'vol, pan, reverb, delay, mute or solo').toLowerCase();
      if (key === 'mute' || key === 'solo') return show(await edit({ op: 'track.set', track, key, value: onOff(args[2]) }));
      if (key === 'pan') return show(await edit({ op: 'track.set', track, key, value: panArg(args[2]) }));
      if (!['vol', 'reverb', 'delay'].includes(key)) throw new Error(`mix has no "${key}" (it has: vol, pan, reverb, delay, mute, solo)`);
      return show(await edit({ op: 'track.set', track, key, value: percent(args[2], 'a level (0 to 100)') }));
    }
    case 'clip': return clipCommand(args);
    case 'drums': {
      const clip = need(args[0], 'a clip (c1, c2, …)');
      return showClip(await edit({ op: 'clip.rows', clip, lines: lines(args.slice(1).filter((a) => a !== '--clear')), clear: args.includes('--clear') }), clip);
    }
    case 'hit': {
      const clip = need(args[0], 'a clip (c1, c2, …)');
      const level = args[3] ?? 'normal';
      if (level !== 'off' && !(level in LEVELS)) throw new Error(`"${level}" is not a level (ghost, soft, normal, accent, off)`);
      return showClip(await edit({ op: 'clip.step', clip, voice: need(args[1], 'a drum'), step: barArg(need(args[2], 'a step')), vel: level === 'off' ? 0 : LEVELS[level] }), clip);
    }
    case 'notes': return notesCommand(args);
    case 'undo':
    case 'redo': return show(await edit({ op: cmd }));
    case 'play':
    case 'stop': {
      const bar = cmd === 'play' && args[0] !== undefined ? barArg(args[0]) : 0;
      const { pages, awake } = await call('POST', '/api/transport', { action: cmd, bar });
      if (!pages) return console.log(`no page is open, so nothing sounds: open ${PAGE}`);
      if (cmd === 'stop') return console.log('stopped');
      return console.log(`playing from bar ${bar + 1} on the page${awake ? '' : " (sent, but the page's sound is off and a browser keeps a page silent until it is clicked: click Start sound on the page)"}`);
    }
    case 'export': {
      if (args[0] !== 'midi') throw new Error('export midi <file>   (WAV export is the button on the page)');
      const file = path.resolve(need(args[1], 'a file name'));
      const res = await fetch(`${BASE}/api/export.mid`);
      if (!res.ok) throw new Error((await res.json()).error);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return console.log(`wrote ${file}`);
    }
    case 'wait': {
      const seconds = Math.min(60, Math.max(0, Number(args[0] ?? 30)));
      const { notes } = await call('GET', `/api/wait?ms=${seconds * 1000}`);
      return console.log(notes.length ? notes.map((n) => `note: ${n.text}`).join('\n') : '(no notes)');
    }
    case 'say': {
      await call('POST', '/api/say', { text: need(args[0], 'what to say') && args.join(' ') });
      return console.log('said');
    }
    default: throw new Error(`no command "${cmd}" (see: claudebase help)`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
