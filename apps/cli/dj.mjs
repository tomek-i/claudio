#!/usr/bin/env node
// `dj` — the control surface Claude uses to DJ. Talks to server.mjs over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FX, FX_DEFAULT_AT } from '../server/lib/fx.mjs';
import { ROOT, DJ_DIR, CONFIG_FILE, SERVER_FILE, CLI_EXT_DIR } from '../server/lib/paths.mjs';

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = Number(process.env.DJ_PORT || config.port || 4747);
const BASE = `http://localhost:${PORT}`;

// ---------- args
const argv = process.argv.slice(2);
const pos = [], flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true;
  } else pos.push(a);
}
const [cmd = 'help', ...rest] = pos;
const JSON_OUT = !!flags.json;

// ---------- http
async function api(p, body) {
  let res;
  try {
    res = await fetch(BASE + p, body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  } catch {
    fail(`DJ server is not running. Start it with:  node dj.mjs start`);
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

// ---------- formatting
const mmss = (s) => (s == null || isNaN(s) ? '--:--' : `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}`);
const name = (t) => `${t.artist ? t.artist + ' - ' : ''}${t.title || '?'}`;
function fmtTrack(t, extra = '') {
  return `${t.id}  ${String(t.bpm?.toFixed?.(1) ?? '?').padStart(5)} BPM  ${String(t.camelot || '?').padEnd(3)}  E${t.energy ?? '?'}  ${mmss(t.duration)}  ${name(t)}${extra}`;
}
function fmtState(s) {
  const lines = [];
  if (!s.engine?.connected) lines.push(`⚠ Audio engine not connected — open ${BASE} and click "Start engine".`);
  else if (s.engine.stale) lines.push('⚠ Engine state is stale (tab asleep?)');
  if (s.master) lines.push(`MASTER  xfade ${s.master.xfader?.toFixed(2)} (0=A 1=B)  vol ${s.master.volume}  live: ${s.live || '—'}`);
  for (const [n, d] of Object.entries(s.decks || {})) {
    if (!d.trackId) { lines.push(`DECK ${n}  (empty)`); continue; }
    const pct = d.rate ? ((d.rate - 1) * 100).toFixed(1) : '0.0';
    lines.push(`DECK ${n}  ${d.playing ? '▶' : '⏸'} ${name(d)}  [${d.trackId}]`);
    lines.push(`        ${(d.bpm * (d.rate || 1)).toFixed(1)} BPM (${pct >= 0 ? '+' : ''}${pct}%)  ${d.camelot}  E${d.energy}  ${mmss(d.position)} / ${mmss(d.duration)}  remaining ${mmss(d.remaining)}  bar ${d.bar ?? '-'}.${d.beatInBar ?? '-'}` +
      (d.untilMixOut != null ? `  mix-out ${d.untilMixOut > 0 ? 'in ' + mmss(d.untilMixOut) : 'PASSED'}` : ''));
    lines.push(`        vol ${d.vol}  trim ${d.trim > 0 ? '+' : ''}${d.trim ?? 0} dB  eq L${d.eq?.low} M${d.eq?.mid} H${d.eq?.high}  filter ${d.filter}  echo ${d.echo}${d.loop ? `  LOOP ${d.loop.beats} beats` : ''}${d.loading ? '  (loading…)' : ''}  audible ${d.audible}`);
  }
  if (s.transition) lines.push(`TRANSITION ${s.transition.from}→${s.transition.to} ${s.transition.style}, ends in ${mmss((s.transition.endAt - Date.now()) / 1000)}`);
  if (s.inbox) lines.push(`📨 ${s.inbox} crowd request(s) waiting — run: dj inbox --clear`);
  if (s.history?.length) lines.push(`Recently played: ${s.history.slice(-5).map((h) => h.title).join(' · ')}`);
  if (s.autoDJ || s.plan || s.queue?.length) lines.push(`AUTO    auto-DJ ${s.autoDJ?.enabled ? 'on' : 'off'}${s.autoDJ?.prepared ? ` (next ready on ${s.autoDJ.prepared.deck})` : ''}${s.activeSet ? `  set "${s.activeSet.name}" ${s.activeSet.played.length}/${s.activeSet.total}${s.activeSet.done ? ' finished' : ''}` : ''}  plan ${s.plan?.pending || 0} pending${s.plan?.next ? ` (next ${s.plan.next.id} ${s.plan.next.cmd} in ${mmss(Math.max(0, s.plan.next.eta))})` : ''}  queue ${s.queue?.length || 0}`);
  if (s.monitor?.phase?.offsetMs != null) lines.push(`EARS    phase ${s.monitor.phase.decks.join('/')} ${s.monitor.phase.offsetMs} ms`);
  for (const w of s.monitor?.warnings || []) lines.push(`⚠ ${w.msg}`);
  return lines.join('\n');
}
function report(r) {
  if (JSON_OUT) return out(r);
  if (r.ok === false) fail(r.error);
  if (r.result && typeof r.result === 'object' && Object.keys(r.result).length) console.log('✓', JSON.stringify(r.result));
  else console.log('✓ done');
  if (r.state) console.log(fmtState(r.state));
}
const deckArg = (d) => { const D = String(d || '').toUpperCase(); if (!['A', 'B', 'C', 'D'].includes(D)) fail(`deck must be A, B, C or D (got "${d ?? ''}")`); return D; };
const num = (v, label) => { const n = Number(v); if (v === undefined || isNaN(n)) fail(`${label} must be a number`); return n; };
const control = (c, args) => api('/api/cmd', { cmd: c, args, why: flags.why }).then(report);

// ---------- commands
const commands = {
  async start() {
    try { await fetch(BASE + '/api/state'); console.log(`✓ Already running at ${BASE}`); }
    catch {
      const logFile = path.join(DJ_DIR, 'server.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const fd = fs.openSync(logFile, 'a');
      const child = spawn(process.execPath, [SERVER_FILE], { detached: true, stdio: ['ignore', fd, fd], cwd: ROOT, windowsHide: true });
      child.unref();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        try { await fetch(BASE + '/api/state'); break; } catch { /* waiting */ }
      }
      console.log(`✓ DJ server started at ${BASE}  (log: .dj/server.log)`);
    }
    if (!flags['no-open']) await commands.open();
    const s = await api('/api/state');
    if (!s.engine?.connected) console.log('→ In the browser, click "Start engine" so audio can play (browsers require one click).');
  },
  async open() {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', BASE]] : process.platform === 'darwin' ? ['open', [BASE]] : ['xdg-open', [BASE]];
    spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    console.log(`✓ Opened ${BASE}`);
  },
  async stop() {
    fail('Stop the server by closing its process (Ctrl+C if started with npm start).');
  },
  async doctor() {
    const d = await api('/api/doctor');
    if (flags.fix && !d.ytdlp) { const r = await api('/api/ytdlp/install', {}); d.ytdlp = r.path; }
    if (JSON_OUT) return out(d);
    console.log(`server     ✓ ${BASE}`);
    console.log(`engine     ${d.engine.connected ? '✓ connected' : '✗ not connected (open the UI and click Start engine)'}`);
    console.log(`yt-dlp     ${d.ytdlp ? '✓ ' + d.ytdlp : '✗ not installed yet (auto-installs on first download, or run: dj doctor --fix)'}`);
    if (d.stems) console.log(`stems      ${!d.stems.enabled ? '– switched off (config.json → stems.enabled)' : d.stems.available ? '✓ separator installed' : '✗ not set up (run: dj stems setup)'}`);
    console.log(`library    ${d.library.tracks} tracks  (${d.library.analyzing} analysing, ${d.library.queued} queued)`);
    console.log(`folders    ${d.dirs.join(' | ')}`);
    console.log(`downloads  ${d.downloadDir}`);
  },
  async status() {
    const s = await api('/api/state');
    JSON_OUT ? out(s) : console.log(fmtState(s));
  },
  async library() {
    const q = new URLSearchParams();
    if (rest.length) q.set('q', rest.join(' '));
    for (const k of ['bpm', 'key', 'energy', 'genre', 'sort', 'limit']) if (flags[k]) q.set(k, flags[k]);
    if (flags.compatible) q.set('compatibleWith', flags.compatible);
    if (!flags.limit) q.set('limit', '60');
    const r = await api('/api/library?' + q);
    if (JSON_OUT) return out(r);
    const st = r.status;
    console.log(`${r.tracks.length} shown of ${st.tracks} tracks${st.analyzing || st.queued ? `  (analysing ${st.analyzing}, queued ${st.queued})` : ''}`);
    console.log('id        BPM       key  E   len   track');
    for (const t of r.tracks) console.log(fmtTrack(t));
  },
  async find() {
    const q = rest.join(' '); if (!q) fail('usage: dj find "<artist - title>"');
    const r = await api(`/api/download/search?q=${encodeURIComponent(q)}&n=${flags.n || 8}`);
    if (JSON_OUT || !Array.isArray(r)) return out(r);
    for (const v of r) console.log(`${mmss(v.duration)}  ${v.title}  — ${v.channel}\n       ${v.url}`);
  },
  async get() {
    const input = rest.join(' '); if (!input) fail('usage: dj get <url | "artist - title"> [--playlist] [--max N]');
    console.log(`⬇ ${input} …`);
    const j = await api('/api/download', { input, playlist: !!flags.playlist, max: flags.max ? Number(flags.max) : 25, wait: true });
    if (JSON_OUT) return out(j);
    if (j.status !== 'ready') fail(j.error || `download ${j.status}`);
    for (const t of j.tracks) console.log('✓ ' + fmtTrack(t));
  },
  async scan() { out(await api('/api/library/scan', { force: !!flags.force })); },
  async load() { const deck = deckArg(rest[0]); const track = rest.slice(1).join(' '); if (!track) fail('usage: dj load <A|B|C|D> <trackId | search>'); return control('load', { deck, track, cue: flags.cue }); },
  async play() { return control('play', { deck: deckArg(rest[0]), at: flags.at }); },
  async pause() { return control('pause', { deck: deckArg(rest[0]) }); },
  async cue() { return control('cue', { deck: deckArg(rest[0]), position: rest[1] }); },
  async seek() { return control('seek', { deck: deckArg(rest[0]), position: rest[1] }); },
  async sync() { return control('sync', { deck: deckArg(rest[0]) }); },
  async tempo() { return control('tempo', { deck: deckArg(rest[0]), value: rest[1] }); },
  async eq() {
    const band = rest[1]; if (!['low', 'mid', 'high'].includes(band)) fail('usage: dj eq <A|B|C|D> <low|mid|high> <-1..1> [--ramp beats]');
    return control('eq', { deck: deckArg(rest[0]), band, value: num(rest[2], 'value'), ramp: flags.ramp });
  },
  async filter() { return control('filter', { deck: deckArg(rest[0]), value: num(rest[1], 'value'), ramp: flags.ramp }); },
  async vol() { return control('vol', { deck: deckArg(rest[0]), value: num(rest[1], 'value'), ramp: flags.ramp }); },
  async trim() {
    const db = num(rest[1], 'dB'); if (db < -12 || db > 12) fail('usage: dj trim <deck> <-12..12 dB> [--ramp beats]   (0 = the track\'s analysed gain)');
    return control('trim', { deck: deckArg(rest[0]), value: db, ramp: flags.ramp });
  },
  async echo() { return control('echo', { deck: deckArg(rest[0]), value: num(rest[1], 'value'), ramp: flags.ramp }); },
  async xfade() { return control('xfade', { value: num(rest[0], 'value'), ramp: flags.ramp }); },
  async master() { return control('master', { value: num(rest[0], 'value') }); },
  async loop() {
    const deck = deckArg(rest[0]), what = rest[1];
    if (what === 'half' || what === 'double') return control('loop', { deck, beats: what });
    if (what === 'move') {
      const n = Number(rest[2]);
      if (!Number.isInteger(n) || !n) fail('usage: dj loop <deck> move <n>   (whole loop lengths: -1 = back one, 1 = forward one)');
      return control('loop', { deck, beats: 'move', n });
    }
    return control('loop', { deck, beats: what === 'off' ? 0 : num(what ?? 8, 'beats') });
  },
  async perform() {
    const raw = flags.steps || rest.join(' ');
    let steps;
    try { steps = JSON.parse(fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8') : raw); } catch { fail('usage: dj perform \'[{"b":0,"d":"A","c":"filter","v":0.6,"o":8}, {"b":8,"d":"A","loop":1}]\' [--at bar|phrase|now]'); }
    return control('perform', { steps, at: flags.at || 'bar', ref: flags.ref });
  },
  async fx() {
    const name = rest[0], D = deckArg(rest[1] || (await api('/api/state')).live);
    const presets = FX(D);
    if (!presets[name]) fail(`unknown fx "${name}". Available: ${Object.keys(presets).join(', ')}`);
    return control('perform', { steps: presets[name], at: flags.at || FX_DEFAULT_AT[name] || 'bar', ref: D });
  },
  async record() {
    const sub = rest[0] || 'status';
    if (sub === 'start') { const r = await api('/api/record/start', { screen: !flags['no-screen'], mic: !flags['no-mic'] }); console.log('⏺ recording →', r.dir); return; }
    if (sub === 'stop') { const r = await api('/api/record/stop', {}); if (r.error) fail(r.error); console.log('⏹ saved →', r.dir); console.log('  run: node dj.mjs report'); return; }
    out(await api('/api/record'));
  },
  async report() {
    const { buildReport } = await import('../server/lib/report.mjs');
    const root = path.join(DJ_DIR, 'sessions');
    const id = rest[0] || fs.readdirSync(root).sort().pop();
    if (!id) fail('no sessions recorded yet');
    console.log(await buildReport(path.join(root, id)));
  },
  async mix() {
    const from = deckArg(rest[0]), to = deckArg(rest[1]);
    return control('mix', { from, to, track: flags.track, style: flags.style || 'blend', bars: flags.bars != null ? Number(flags.bars) : undefined, at: flags.at || 'bar', in: flags.in, glide: !flags['no-glide'] });
  },
  async wait() {
    const kind = rest[0] || 'mixout';
    const q = new URLSearchParams({ for: kind, timeout: flags.timeout || 540 });
    if (flags.deck) q.set('deck', deckArg(flags.deck));
    if (kind === 'mixout') q.set('seconds', flags.seconds ?? rest[1] ?? 20);
    if (kind === 'remaining' || kind === 'time') q.set('seconds', rest[1] ?? flags.seconds ?? 60);
    if (kind === 'bar') q.set('bar', rest[1]);
    if (flags['ignore-inbox']) q.set('inbox', 'ignore');
    const r = await api('/api/wait?' + q);
    if (JSON_OUT) return out(r);
    console.log(`⏱ ${r.reason} (waited ${r.waitedSec}s)`);
    if (r.reason === 'inbox') for (const m of r.inbox) console.log(`📨 ${m.from}: ${m.text}`);
    console.log(fmtState(r.state));
  },
  async inbox() {
    const r = await api('/api/inbox' + (flags.clear ? '?clear=1' : ''));
    if (JSON_OUT) return out(r);
    if (!r.length) return console.log('(no requests)');
    for (const m of r) console.log(`${new Date(m.ts).toLocaleTimeString()}  ${m.from}: ${m.text}`);
  },
  async say() { const text = rest.join(' '); if (!text) fail('usage: dj say "message" [--speak]'); await api('/api/say', { text, speak: !!flags.speak }); console.log('✓ posted'); },
  async log() { const r = await api('/api/log?n=' + (flags.n || 30)); for (const e of r) console.log(`${new Date(e.ts).toLocaleTimeString()} [${e.kind}] ${e.text}`); },
  async history() { const r = await api('/api/history'); if (JSON_OUT) return out(r); for (const h of r) console.log(`${new Date(h.at).toLocaleTimeString()}  ${h.deck}  ${h.artist ? h.artist + ' - ' : ''}${h.title}  [${h.id}]`); },
  async help() {
    console.log(`dj — DJ Claude control surface  (server: ${BASE})

SETUP     start | open | doctor [--fix] | status [--json] | banner [name]   (preview the startup animations)
CRATE     library [search] [--bpm 140-150] [--key 8A,9A] [--energy 6-9] [--compatible <id>] [--sort bpm|energy|key|added]
          track <id>                       full analysis: grid, key, intro/outro, breakdowns
          suggest [--from <id>] [--direction up|down|hold]   best next tracks (harmonic + tempo + energy)
          find "<query>"                   search YouTube without downloading
          get <url | "artist - title"> [--playlist --max N]   download + analyse
          scan [--force]                   rescan library folders
          starter [--list] [--force]       download the Creative Commons starter crate into library/starter
DECKS     load <deck> <id|search>   play <deck> [--at bar]   pause <deck>   cue <deck> [sec]   seek <deck> <sec|bar:N>
          sync <deck>   tempo <deck> <bpm|+2%>   loop <deck> <beats|off|half|double>   loop <deck> move <n>   (n loop lengths, -1 = back)
MIXER     vol <deck> <0-1.54>  (1 = normal)   eq <deck> <low|mid|high> <-1..1>   filter <deck> <-1..1>   echo <deck> <0-1>
          trim <deck> <-12..12 dB>   (gain before the EQ, on top of the track's analysed gain)
          xfade <0-1>   master <0-1.8>  (0.9 = normal)   (add --ramp <beats> to any of these to automate)
MIX       mix <from> <to> [--track <id>] [--style blend|bassswap|double|fade|filter|echo|cut|brake|spinback]
              [--bars 16] [--at now|bar|phrase] [--in mixin|intro|drop|<sec>|bar:N] [--no-glide]
TIMING    wait mixout [--seconds 20] | wait remaining <sec> | wait transition | wait end | wait bar <n> | wait time <sec>
          (waits return early when the crowd sends a request)
REC       record start|stop|status [--no-screen --no-mic]   report [sessionId]
CROWD     inbox [--clear]   say "text" [--speak]   log   history
FX        fx <rollup|roll|chop|scratchcut|wobble|kills|throw|sweep> [deck] [--at drop|phrase-end|phrase|bar|now]
          perform '<json steps>'   beat-scheduled knob choreography (see dj-mix skill)
SET       plan add '<json>'|show|clear   queue add <id…>|show|clear   autodj on|off   monitor   rate good|bad [note]   memory
          suggest --mashup   export [session] [--format mp3|m4a]
          sets [show|new|add|rm|move|pick|then|use|off|save|open|delete]   saved sets: tracks Auto-DJ plays from, decks + mixer (dj sets help)
          automation [record|play|over|stop|clear]   record everything done on the decks from the set's 0:00, play it back (dj automation help)
TRACK     sections <id>   grid <id> [--shift beats --nudge ms --bpm x --reset]   stems [id|all|status|setup [--gpu]]   vocals <id>
          hotcue <deck> [set <n> [bar:N]] | <n>     savedloop <deck> [set <name> <beats>] | <name>
KEYS      keys [grab <deck> | note <semis> | loop rec|play|stop|clear | set]   the chop keyboard (see apps/cli/cli-ext/keys.mjs)
VISUALS   visuals [<mode>|auto]   the /visuals page for a second screen: who is watching, or change the mode on every open page
PAGE      crate hide|show|toggle   hide or show the bottom panel (library, sampler, booth) on every open page (e.g. before recording)
ENGINE    keylock, key, stem, xfassign, sample(r), deckfx, scratch: see  dj help-engine
GLOBAL    --why "reason"   shows your reasoning in the booth feed      --json   raw output`);
  },
};

// CLI extensions: every apps/cli/cli-ext/*.mjs default-exports (helpers) => ({ commandName: async fn })
const extDir = CLI_EXT_DIR;
if (fs.existsSync(extDir)) {
  for (const f of fs.readdirSync(extDir).filter((x) => x.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(extDir, f)).href);
    Object.assign(commands, mod.default({ api, control, flags, rest, pos, cmd, deckArg, num, fail, out, report, fmtState, fmtTrack, mmss, name, ROOT, BASE, JSON_OUT }));
  }
}
const fn = commands[cmd];
if (!fn) fail(`unknown command "${cmd}". Run: dj help`);
await fn();

