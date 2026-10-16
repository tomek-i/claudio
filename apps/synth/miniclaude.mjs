#!/usr/bin/env node
// The synth from the terminal: `node miniclaude.mjs help`. This is how Claude plays it: read the patch as text, set
// parameters by name, write the sequence as a row of notes, and ask the open page to sound it. It talks to the
// server (server.mjs) and starts it when it is not running.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, DEFAULT_PORT } from './lib/app.mjs';
import { groupOf, paramDef, paramsText, patchText } from './lib/patch.mjs';
import { seqText } from './lib/seq.mjs';
import { parseNote } from './lib/notes.mjs';
import { ANIMATIONS, animate } from './lib/banner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MINICLAUDE_PORT) || DEFAULT_PORT;
const BASE = `http://127.0.0.1:${PORT}`;
const URL_SHOWN = `http://localhost:${PORT}`;

const HELP = `${APP_NAME} synthesizer — ${URL_SHOWN}

  show [--json]                  the playing patch and the sequence
  params                         every parameter, its range and its default
  open                           start the server if needed and print the address
  banner [name | --list]         preview the server's startup animations (MINICLAUDE_BANNER=<name> picks one)

 the sound
  set <param> <value> …          one or more: set filter.cutoff 800 resonance 60%
                                 (the last part of a name is enough when only one parameter has it)
  preset [name]                  load a preset, yours or a built-in one (no name: list them, yours first)
  preset save [name]             save the playing patch as a preset (no name: under its own name;
                                 the same name again replaces it)
  preset delete <name>           delete a saved preset
  init                           the plain patch: one saw, filter open
  name <text>                    name the patch
  slot <A-D>      copy <A-D>     switch slot | copy the playing patch to a slot
  undo   redo

 the sequence (16 sixteenths: . rest, - tie, + chord, ! accent, :50 velocity)
  seq "<row>"                    seq "C2 . C3 - | Eb2 . C3! G2 | C2 . Bb2 C3 | . G2 Bb2 -"
                                 (1, 2, 4 or 8 tokens are repeated to fill the bar; no row: show it)
  step <1-16> <token>            one step: step 5 Eb2+G2   step 6 -   step 7 .
  bpm <40-240>   gate <5-100>   swing <0-100>
  transpose <semitones>   clearseq

 hearing it (the page makes the sound: it has to be open, and "Start sound" clicked on it)
  play [loops]                   start the sequence on the page (no number: until stop)
  note <notes…> [<seconds>s]     hold a note or a chord: note C3 Eb3 G3 2s
  stop

 the note box on the page
  wait [seconds]                 wait for a note typed on the page (at most 60 s)
  say <text>                     answer on the page`;

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
const playing = (state) => state.slots[state.slot];
const title = (state) => `slot ${state.slot}  "${playing(state).name}"`;
const show = (state, groups) => console.log(`${title(state)}\n${patchText(playing(state), groups)}${groups ? '' : `\n${seqText(state.seq)}`}`);
const showSeq = (state) => console.log(seqText(state.seq));

const need = (value, what) => {
  if (value === undefined) throw new Error(`missing: ${what} (see: miniclaude help)`);
  return value;
};
const percent = (text) => {
  const n = Number(String(text).replace(/%$/, ''));
  if (!Number.isFinite(n)) throw new Error(`"${text}" is not a number`);
  return n <= 1 && !String(text).endsWith('%') ? n : n / 100;   // 0.6 as `show` prints it, or 60
};

// what the page did with a request to sound
function heard({ pages, awake }, what) {
  if (!pages) return console.log(`no page is open, so nothing sounds: open ${URL_SHOWN}`);
  console.log(awake ? what : `${what} (sent, but the page's sound is off and a browser keeps a page silent until it is clicked: click Start sound on the page)`);
}

async function previewBanner(name) {
  const names = Object.keys(ANIMATIONS);
  if (name === '--list') return console.log(names.join('\n'));
  if (name && !ANIMATIONS[name]) throw new Error(`no animation "${name}" (there are: ${names.join(', ')})`);
  if (!process.stdout.isTTY) throw new Error('the banner draws in place, so it needs a terminal (not a pipe or a file)');
  const play = name ? [name] : names;
  for (const [i, n] of play.entries()) {
    console.log(`\n  ${n}${play.length > 1 ? `  (${i + 1}/${play.length})` : ''}   MINICLAUDE_BANNER=${n} starts the server with this one`);
    await animate(ANIMATIONS[n]);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main([cmd = 'help', ...args]) {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return console.log(HELP);
  if (cmd === 'banner') return previewBanner(args[0]);
  if (cmd === 'params') return console.log(paramsText());
  await ensureServer();
  switch (cmd) {
    case 'open': return console.log(URL_SHOWN);
    case 'show': {
      const state = await call('GET', '/api/state');
      return args.includes('--json') ? console.log(JSON.stringify({ slot: state.slot, patch: playing(state), seq: state.seq }, null, 1)) : show(state);
    }
    case 'set': {
      if (!args.length || args.length % 2) throw new Error('set takes pairs: set <param> <value> [<param> <value> …]');
      const values = {};
      for (let i = 0; i < args.length; i += 2) values[paramDef(args[i]).id] = args[i + 1];
      return show(await edit({ op: 'set', values }), [...new Set(Object.keys(values).map(groupOf))]);
    }
    case 'preset': {
      if (!args.length) return console.log((await call('GET', '/api/state')).presets.map((p) => `${p.kind.padEnd(7)}${p.name}`).join('\n'));
      if (args[0] === 'save') return console.log(`${title(await edit({ op: 'savepreset', name: args.length > 1 ? args.slice(1).join(' ') : undefined }))}  saved as a preset`);
      if (args[0] === 'delete') {
        const name = need(args[1], 'the name of a saved preset') && args.slice(1).join(' ');
        await edit({ op: 'deletepreset', name });
        return console.log(`deleted the preset "${name}"`);
      }
      return show(await edit({ op: 'preset', name: args.join(' ') }));
    }
    case 'init': return show(await edit({ op: 'init' }));
    case 'name': return console.log(title(await edit({ op: 'name', value: need(args[0], 'a name') && args.join(' ') })));
    case 'slot': return show(await edit({ op: 'slot', slot: String(need(args[0], 'a slot')).toUpperCase() }));
    case 'copy': {
      const state = await edit({ op: 'copy', to: String(need(args[0], 'a slot')).toUpperCase() });
      return console.log(`${title(state)}  copied to ${args[0].toUpperCase()}`);
    }
    case 'undo':
    case 'redo': return show(await edit({ op: cmd }));
    case 'seq': return showSeq(args.length ? await edit({ op: 'row', text: args.join(' ') }) : await call('GET', '/api/state'));
    case 'step': {
      const step = Number(need(args[0], 'a step'));
      if (!Number.isInteger(step) || step < 1) throw new Error(`"${args[0]}" is not a step (steps count from 1)`);
      return showSeq(await edit({ op: 'step', step: step - 1, token: need(args[1], 'a note, . or -') }));
    }
    case 'bpm': return showSeq(await edit({ op: 'seqparam', key: 'bpm', value: Number(need(args[0], 'a tempo')) }));
    case 'gate':
    case 'swing': return showSeq(await edit({ op: 'seqparam', key: cmd, value: percent(need(args[0], 'an amount, 0 to 100')) }));
    case 'transpose': return showSeq(await edit({ op: 'transpose', by: Number(need(args[0], 'semitones')) }));
    case 'clearseq': return showSeq(await edit({ op: 'clearseq' }));
    case 'play': {
      const loops = Number(args[0]) || 0;
      return heard(await call('POST', '/api/play', { action: 'seq', loops }), loops ? `playing the sequence ${loops} time${loops === 1 ? '' : 's'}` : 'playing the sequence until: stop');
    }
    case 'stop': return heard(await call('POST', '/api/play', { action: 'stop' }), 'stopped');
    case 'note': {
      const seconds = args.length > 1 && /^[\d.]+s$/.test(args.at(-1)) ? Number(args.pop().slice(0, -1)) : 1;
      const notes = args.map(parseNote);
      if (!notes.length) throw new Error('note <notes…> [<seconds>s]');
      return heard(await call('POST', '/api/play', { action: 'notes', notes, seconds }), `sounding ${args.join(' ')} for ${seconds} s`);
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
    default: throw new Error(`no command "${cmd}" (see: miniclaude help)`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
