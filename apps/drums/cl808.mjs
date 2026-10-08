#!/usr/bin/env node
// The drum machine from the terminal: `node cl808.mjs help`. This is how Claude plays it: read the beat as
// text, write rows, move single hits off the grid, and use the same groove tools the page has. It talks to the
// server (server.mjs) and starts it when it is not running.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toText } from './lib/pattern.mjs';
import { LEVELS } from './lib/kit.mjs';
import { stepSeconds } from './lib/timing.mjs';
import { FEELS } from './lib/groove.mjs';
import { ANIMATIONS, animate } from './lib/banner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CL808_PORT) || 4748;
const BASE = `http://127.0.0.1:${PORT}`;

const HELP = `Claude-808 drum machine — http://localhost:${PORT}

  show [--json]                  the playing pattern (steps: . off, g ghost, o soft, x normal, X accent)
  open                           start the server if needed, print the address and whether the page can be heard
  banner [name | --list]         preview the server's startup animations (CL808_BANNER=<name> picks one)

 writing a beat
  write [--clear] "<row>" …      whole rows: write "kick x...x...x...x..." "snare ....X.......X..."
                                 (--clear empties the other rows first; a 32-step row makes the pattern 32 steps)
  hit <voice> <step> [level]     one step: ghost | soft | normal | accent | off   (steps count from 1)
  nudge <voice> <step> <by>      a hit off the grid: +0.1 is a tenth of a step late, -12ms is 12 ms early
  clear [voice]                  empty one row, or all of them
  bpm <40-240>   swing <0-100>   steps <16|32>   name <text>
  level <voice> <0-100>   tune <voice> <semitones>   mute <voice> [off]   solo <voice> [off]

 groove
  humanize [feel] [0-100]        ${Object.keys(FEELS).join(' | ')}: moves hits and velocities, never adds or removes
  quantize                       back on the grid: every offset gone, velocities at the four levels
  vary [0-100]                   four versions near the beat (how wild), shown here and on the page
  pick <1-4>                     take one of them
  continue                       write bar 2 from bar 1, with a fill
  morph <slot> <0-100>           towards the pattern in another slot

 patterns
  slot <A-D>      copy <A-D>     switch slot | copy the playing pattern to a slot
  preset [name]                  load a starting beat (no name: list them)
  undo   redo
  export midi <file> [loops]     the timing is in the file (WAV export is on the page)

 the note box on the page
  wait [seconds]                 wait for a note typed on the page (at most 60 s)
  say <text>                     answer on the page

voices: kick snare clap hat open tom rim bell`;

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
const SILENT = 'a page is open, but its sound is off and a browser keeps a page silent until it is clicked: click Start sound on the page';
const playing = (state) => state.slots[state.slot];
const show = (state) => console.log(`slot ${state.slot}  ${toText(playing(state))}`);

const percent = (text, fallback) => {
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`"${text}" is not a number`);
  return n / 100;
};
const stepArg = (text) => {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error(`"${text}" is not a step (steps count from 1)`);
  return n - 1;
};
const need = (value, what) => {
  if (value === undefined) throw new Error(`missing: ${what} (see: cl808 help)`);
  return value;
};
const onOff = (text) => !['off', '0', 'false', 'no'].includes(String(text ?? 'on').toLowerCase());

async function previewBanner(name) {
  const names = Object.keys(ANIMATIONS);
  if (name === '--list') return console.log(names.join('\n'));
  if (name && !ANIMATIONS[name]) throw new Error(`no animation "${name}" (there are: ${names.join(', ')})`);
  if (!process.stdout.isTTY) throw new Error('the banner draws in place, so it needs a terminal (not a pipe or a file)');
  const play = name ? [name] : names;
  for (const [i, n] of play.entries()) {
    console.log(`\n  ${n}${play.length > 1 ? `  (${i + 1}/${play.length})` : ''}   CL808_BANNER=${n} starts the server with this one`);
    await animate(ANIMATIONS[n]);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main([cmd = 'help', ...args]) {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return console.log(HELP);
  if (cmd === 'banner') return previewBanner(args[0]);
  await ensureServer();
  switch (cmd) {
    case 'open': {
      console.log(`${BASE.replace('127.0.0.1', 'localhost')}`);
      const page = await call('GET', '/api/transport').catch(() => null);   // a server from before it could say
      if (!page) return;
      if (!page.pages) return console.log('no page is open, so nothing sounds: open the address in a browser');
      return console.log(page.awake ? 'a page is open and its sound is on' : SILENT);
    }
    case 'show': {
      const state = await call('GET', '/api/state');
      return args.includes('--json') ? console.log(JSON.stringify(playing(state), null, 1)) : show(state);
    }
    case 'write': {
      const clear = args.includes('--clear');
      const lines = args.filter((a) => a !== '--clear').flatMap((a) => a.split('\n')).filter((l) => l.trim());
      return show(await edit({ op: 'write', lines, clear }));
    }
    case 'hit': {
      const level = args[2] ?? 'normal';
      if (level !== 'off' && !(level in LEVELS)) throw new Error(`"${level}" is not a level (ghost, soft, normal, accent, off)`);
      return show(await edit({ op: 'step', track: need(args[0], 'a voice'), step: stepArg(need(args[1], 'a step')), vel: level === 'off' ? 0 : LEVELS[level] }));
    }
    case 'nudge': {
      const by = String(need(args[2], 'how far'));
      const state = await call('GET', '/api/state');
      const ms = /^([+-]?[\d.]+)\s*ms$/i.exec(by);
      const off = ms ? Number(ms[1]) / 1000 / stepSeconds(playing(state).bpm) : Number(by);
      if (!Number.isFinite(off)) throw new Error(`"${by}" is not a distance (+0.1 of a step, or -12ms)`);
      return show(await edit({ op: 'step', track: need(args[0], 'a voice'), step: stepArg(need(args[1], 'a step')), off }));
    }
    case 'clear': return show(await edit({ op: 'clear', track: args[0] }));
    case 'bpm': return show(await edit({ op: 'param', key: 'bpm', value: Number(need(args[0], 'a tempo')) }));
    case 'swing': return show(await edit({ op: 'param', key: 'swing', value: percent(need(args[0], 'a swing amount')) }));
    case 'steps': return show(await edit({ op: 'param', key: 'steps', value: Number(need(args[0], '16 or 32')) }));
    case 'name': return show(await edit({ op: 'param', key: 'name', value: need(args[0], 'a name') && args.join(' ') }));
    case 'level': return show(await edit({ op: 'track', track: need(args[0], 'a voice'), key: 'level', value: percent(need(args[1], 'a level')) }));
    case 'tune': return show(await edit({ op: 'track', track: need(args[0], 'a voice'), key: 'tune', value: Number(need(args[1], 'semitones')) }));
    case 'mute':
    case 'solo': return show(await edit({ op: 'track', track: need(args[0], 'a voice'), key: cmd, value: onOff(args[1]) }));
    case 'humanize': {
      const feel = args.find((a) => a in FEELS);
      const amount = args.find((a) => !(a in FEELS));
      return show(await edit({ op: 'humanize', ...(feel && { feel }), ...(amount !== undefined && { amount: percent(amount) }) }));
    }
    case 'quantize': return show(await edit({ op: 'quantize' }));
    case 'vary': {
      const state = await edit({ op: 'vary', wild: percent(args[0], 0.4) });
      state.candidates.forEach((p, i) => console.log(`--- ${i + 1}\n${toText(p).split('\n').slice(2).join('\n')}`));
      return console.log('take one with: pick <1-4>');
    }
    case 'pick': return show(await edit({ op: 'pick', index: stepArg(need(args[0], 'which one')) }));
    case 'continue': return show(await edit({ op: 'continue' }));
    case 'morph': return show(await edit({ op: 'morph', to: String(need(args[0], 'a slot')).toUpperCase(), amount: percent(args[1], 0.5) }));
    case 'slot': return show(await edit({ op: 'slot', slot: String(need(args[0], 'a slot')).toUpperCase() }));
    case 'copy': return show(await edit({ op: 'copy', to: String(need(args[0], 'a slot')).toUpperCase() }));
    case 'preset': {
      if (!args.length) return console.log((await call('GET', '/api/state')).presets.join('\n'));
      return show(await edit({ op: 'preset', name: args.join(' ') }));
    }
    case 'undo':
    case 'redo': return show(await edit({ op: cmd }));
    case 'export': {
      if (args[0] !== 'midi') throw new Error('export midi <file> [loops]   (WAV export is the button on the page)');
      const file = path.resolve(need(args[1], 'a file name'));
      const res = await fetch(`${BASE}/api/export.mid?loops=${Number(args[2]) || 1}`);
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
    default: throw new Error(`no command "${cmd}" (see: cl808 help)`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
