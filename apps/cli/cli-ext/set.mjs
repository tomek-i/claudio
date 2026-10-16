// Set automation + ears:
//   plan add '<json>' | plan show | plan clear [--all] | plan rm <id>     timeline sequencer
//   queue add <id|search>… | queue show | queue clear | queue rm <n>      track queue
//   autodj [on|off] [--lead 45]                                          auto-DJ safety net
//   sets [show|new|add|rm|move|pick|then|use|off|delete] …               saved sets Auto-DJ plays from (dj sets help)
//   automation [status|record|play|over|stop|clear]                     record the active set's decks, play it back
//   monitor [--watch N]                                                   mix monitor ("ears")
//   rate good|bad [note]    memory [--n 10]                              set memory
//   suggest … [--mashup] [--keylock on|off]                              key-aware suggestions
//   export [sessionId] [--format mp3|m4a]                                mix file + tracklist
import fs from 'node:fs';
import path from 'node:path';
import { DJ_DIR, CACHE_DIR, EXPORTS_DIR } from '../../server/lib/paths.mjs';

export default ({ api, flags, rest, fail, out, fmtTrack, mmss, ROOT, JSON_OUT }) => {
  const nm = (t) => `${t?.artist ? t.artist + ' - ' : ''}${t?.title ?? '?'}`;
  const whenStr = (w) => w.at != null ? `at ${new Date(Number(w.at)).toLocaleTimeString()}`
    : w.after ? `${w.sec || 0}s after ${w.after}`
    : `${w.deck} ${w.bar != null ? 'bar ' + w.bar : w.beforeMixout != null ? w.beforeMixout + 's before mix-out' : w.beforeEnd + 's before end'}${w.track ? ' (track ' + w.track + ')' : ''}`;
  const warnLines = (m) => (m?.warnings || []).map((w) => `⚠ ${w.msg}${w.forSec ? ` (${w.forSec}s)` : ''}`);

  async function showPlan() {
    const list = await api('/api/plan');
    if (JSON_OUT) return out(list);
    if (!list.length) return console.log('(plan is empty)  add: dj plan add \'{"when":{"deck":"A","bar":65},"cmd":"mix","args":{"style":"bassswap","bars":8}}\'');
    for (const st of list) {
      const eta = st.etaSec != null ? `in ${mmss(Math.max(0, st.etaSec))}` : st.status === 'pending' ? 'waiting' : '';
      const args = Object.entries(st.args || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
      console.log(`${st.id.padEnd(5)} ${st.status.padEnd(8)} ${whenStr(st.when).padEnd(28)} ${eta.padEnd(9)} ${st.cmd} ${args}${st.why ? '  — ' + st.why : ''}${st.error ? '  ✗ ' + st.error : ''}${st.late ? '  (late)' : ''}`);
    }
  }

  return {
    async plan() {
      const sub = rest[0] || 'show';
      if (sub === 'add') {
        const raw = flags.steps || rest.slice(1).join(' ');
        let steps;
        try { steps = JSON.parse(fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8') : raw); }
        catch { fail(`usage: dj plan add '{"when":{"deck":"A","bar":65},"cmd":"mix","args":{"to":"B","style":"bassswap","bars":8,"in":"drop"},"why":"…"}'  (or a JSON array / file)`); }
        const r = await api('/api/plan', { add: steps });
        if (JSON_OUT) return out(r);
        if (!r.ok) fail(r.error);
        console.log(`✓ planned ${r.added.join(', ')}`);
        return showPlan();
      }
      if (sub === 'clear') { const r = await api('/api/plan', { clear: true, all: !!flags.all }); return JSON_OUT ? out(r) : console.log(`✓ removed ${r.removed} step(s)`); }
      if (sub === 'rm' || sub === 'remove') { const r = await api('/api/plan', { remove: rest[1] }); return JSON_OUT ? out(r) : console.log(r.ok ? `✓ removed ${rest[1]}` : `✗ no step ${rest[1]}`); }
      return showPlan();
    },

    async queue() {
      const sub = rest[0] || 'show';
      if (sub === 'add') {
        const items = rest.slice(1);
        if (!items.length) fail('usage: dj queue add <id|"search">…');
        const r = await api('/api/queue', { add: items });
        if (JSON_OUT) return out(r);
        if (r.missing?.length) console.log(`✗ no match: ${r.missing.join(', ')}`);
        if (r.added?.length) console.log(`✓ queued ${r.added.length}`);
      } else if (sub === 'clear') { await api('/api/queue', { clear: true }); console.log('✓ queue cleared'); return; }
      else if (sub === 'rm' || sub === 'remove') { await api('/api/queue', { remove: Number(rest[1]) }); }
      const q = await api('/api/queue');
      if (JSON_OUT && sub === 'show') return out(q);
      if (!q.length) return console.log('(queue is empty)');
      q.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t.id}  ${String(t.bpm ?? '?').padStart(6)} BPM  ${String(t.camelot || '?').padEnd(3)}  ${nm(t)}`));
    },

    async autodj() {
      const v = rest[0];
      const r = v === 'on' || v === 'off' || flags.lead ? await api('/api/autodj', { enabled: v ? v === 'on' : true, leadSec: flags.lead ? Number(flags.lead) : undefined }) : await api('/api/autodj');
      if (JSON_OUT) return out(r);
      console.log(`🤖 Auto-DJ ${r.enabled ? 'ON' : 'OFF'} — mixes the next queued/suggested track when ${r.leadSec}s of audible music are left and no mix is planned`);
      if (r.prepared) console.log(`   ready: ${r.prepared.track} on deck ${r.prepared.deck} (${r.prepared.why})`);
      if (r.last) console.log(`   last: ${new Date(r.last.ts).toLocaleTimeString()} ${r.last.from}→${r.last.to} ${r.last.style} ${r.last.bars} bars${r.last.ok ? '' : ' FAILED ' + r.last.error}`);
    },

    async sets() {
      const SETS_HELP = `dj sets                                  list the saved sets (★ = the one Auto-DJ plays from)
dj sets show [name]                      its tracks (default: the active set)
dj sets new "<name>" [track…] [--use]    make a set (tracks are ids or searches); --use makes it the active one
dj sets add "<name>" <track…> [--at n]   add tracks (at position n; default the end)
dj sets rm "<name>" <n>                  take out track n
dj sets move "<name>" <from> <to>        move a track
dj sets pick "<name>" fit|order          fit: Auto-DJ takes the track that fits the live deck best; order: top to bottom
dj sets then "<name>" library|stop       when all have played: carry on from the whole library, or stop
dj sets use "<name>" [--restart]         Auto-DJ plays from it (after the queue); --restart forgets what has played
dj sets off                              Auto-DJ picks from the whole library again
dj sets save "<name>"                    keep the decks and the mixer in the set (makes the set if it is new)
dj sets open "<name>" [--force]          make it the active set and put its decks and mixer back, paused
                                         (--force: even when a deck is playing; it is stopped)
dj sets delete "<name>"`;
      const sub = rest[0] || 'list', name = rest[1];
      const act = async (body) => { const r = await api('/api/sets', body); if (!r.ok) fail(r.error); return r; };
      const needName = () => { if (!name) fail(`usage:
${SETS_HELP}`); };
      const showSet = (st) => {
        if (JSON_OUT) return out(st);
        const played = st.tracks.filter((t) => t.played).length;
        console.log(`${st.active ? '★ ' : ''}${st.name}  ${st.tracks.length} track${st.tracks.length === 1 ? '' : 's'}${st.active ? `, ${played} played` : ''}  pick ${st.pick}, then ${st.then}${st.done ? '  (finished)' : ''}`);
        if (st.snapshot) console.log(`   decks saved ${new Date(st.snapshot.savedAt).toLocaleString()}: ${Object.entries(st.snapshot.decks).map(([n, d]) => `${n} ${nm(d)} @${mmss(d.position)}`).join(' · ')}`);
        st.tracks.forEach((t, i) => console.log(`${String(i + 1).padStart(3)}. ${t.missing ? '✗ missing  ' : `${String(t.bpm?.toFixed?.(1) ?? '?').padStart(6)} ${String(t.camelot || '?').padEnd(3)} `} ${t.played ? '✓ ' : '  '}${nm(t)}  ${t.id}`));
        if (!st.tracks.length) console.log(`   (empty)  add: dj sets add "${st.name}" <id|"search">…`);
      };
      if (sub === 'help') return console.log(SETS_HELP);
      if (sub === 'list' || sub === 'ls') {
        const r = await api('/api/sets');
        if (JSON_OUT) return out(r);
        if (!r.sets.length) return console.log('(no sets yet)  make one: dj sets new "<name>" [track…] --use');
        for (const st of r.sets) console.log(`${r.active?.name === st.name ? '★' : ' '} ${st.name.padEnd(28)} ${String(st.tracks).padStart(3)} tracks  pick ${st.pick}, then ${st.then}${st.saved ? `  decks ${st.saved.decks.join('')}` : ''}${r.active?.name === st.name ? `  (${r.active.played.length} played${r.active.done ? ', finished' : ''})` : ''}`);
        return;
      }
      if (sub === 'show') {
        const n = name || (await api('/api/sets')).active?.name;
        if (!n) fail('no active set: name one (dj sets show "<name>")');
        const st = await api('/api/sets?name=' + encodeURIComponent(n));
        if (st.ok === false) fail(st.error);
        return showSet(st);
      }
      if (sub === 'off') { await act({ action: 'use', name: null }); return console.log('✓ no set: Auto-DJ picks from the whole library'); }
      needName();
      let r;
      if (sub === 'new' || sub === 'create') r = await act({ action: 'create', name, tracks: rest.slice(2), use: !!flags.use });
      else if (sub === 'add') { if (rest.length < 3) fail('usage: dj sets add "<name>" <id|"search">…'); r = await act({ action: 'add', name, tracks: rest.slice(2), at: flags.at }); }
      else if (sub === 'rm' || sub === 'remove') r = await act({ action: 'remove', name, index: rest[2] });
      else if (sub === 'move' || sub === 'mv') r = await act({ action: 'move', name, from: rest[2], to: rest[3] });
      else if (sub === 'pick') r = await act({ action: 'options', name, pick: rest[2] });
      else if (sub === 'then') r = await act({ action: 'options', name, then: rest[2] });
      else if (sub === 'use') r = await act({ action: 'use', name, restart: !!flags.restart });
      else if (sub === 'save') r = await act({ action: 'save', name });
      else if (sub === 'open') {
        r = await api('/api/sets', { action: 'open', name, force: !!flags.force });
        if (!r.ok) fail(r.error + (r.playing ? ' (add --force to open it anyway)' : ''));
        if (JSON_OUT) return out(r);
        if (r.restored) console.log(`✓ decks ${r.decks.join(', ') || '—'} loaded, paused${r.missing.length ? `; not in the library: ${r.missing.map((m) => `${m.deck} ${nm(m)}`).join(', ')}` : ''}${r.failed.length ? `; failed: ${r.failed.map((f) => f.cmd).join(', ')}` : ''}`);
        else console.log('✓ active (no decks saved in it: dj sets save)');
        return showSet(r.set);
      }
      else if (sub === 'delete') { r = await act({ action: 'delete', name }); return console.log(`✓ deleted "${r.deleted}"`); }
      else fail(`unknown: dj sets ${sub}
${SETS_HELP}`);
      if (r.missing?.length) console.log(`✗ no match: ${r.missing.join(', ')}`);
      return showSet(r.set);
    },

    async automation() {
      const HELP = `dj automation                     what it is doing (recording / playing, where, how long the recording is)
dj automation record [--replace]  record the active set from here: the decks as they are become its 0:00, everything
                                  done on the decks and the mixer is kept (knobs, play, loops, cues, FX, scratching…)
                                  while playing back: record over it from now on (each control you touch is replaced)
dj automation play                put the set's decks back and play the recording from 0:00
dj automation over                play it from 0:00 and record over it (a control is replaced from the moment you touch it)
dj automation stop                stop recording or playing (the music carries on); a recording is saved in the set
dj automation export [--format mp3|m4a] [--listen]
                                  the set as a mix file: the recording plays from 0:00 in real time while it is
                                  recorded, then data/dj/exports/<set>.mp3 (+ .txt tracklist, .cue) is written; the
                                  speakers are off meanwhile (--listen: on)
dj automation clear               delete the set's recording`;
      const sub = rest[0] || 'status';
      if (sub === 'help') return console.log(HELP);
      if (sub === 'clear') {
        const active = (await api('/api/sets')).active?.name;
        if (!active) fail('no active set (dj sets use "<name>")');
        const r = await api('/api/sets/automation', { name: active, clear: true });
        if (!r.ok) fail(r.error);
        return console.log(`✓ cleared the recording of "${active}"`);
      }
      const op = { status: 'status', record: 'record', rec: 'record', play: 'play', over: 'overdub', overdub: 'overdub', stop: 'stop', export: 'export' }[sub];
      if (!op) fail(HELP);
      const r = await api('/api/cmd', { cmd: 'automation', args: { op, replace: !!flags.replace, ...(flags.listen ? { listen: true } : {}), ...(flags.format ? { format: flags.format === 'm4a' ? 'm4a' : 'mp3' } : {}) }, why: flags.why });
      if (JSON_OUT) return out(r);
      if (r.ok === false) fail(r.error);
      const a = r.result || {};
      const st = (await api('/api/sets')).active;
      const take = st ? (await api('/api/sets?name=' + encodeURIComponent(st.name))).automation : null;
      const word = a.exporting ? `⤓ exporting (${a.exporting}${a.silent ? ', speakers off' : ''})` : { idle: 'stopped', rec: '⏺ recording', play: '▶ playing', overdub: '⏺ recording over' }[a.mode] || a.mode;
      console.log(`🎚 automation ${word}${a.mode !== 'idle' ? ` at ${mmss(a.t)}${a.duration ? ' / ' + mmss(a.duration) : ''}` : ''}${st ? `  set "${st.name}"` : '  (no active set)'}`);
      if (op === 'export' && a.exporting) console.log(`   it plays in real time: the file is ready in about ${mmss((a.duration || 0) + 5)} (dj automation shows where it is)`);
      if (a.lastExport) console.log(a.lastExport.ok ? `   last export: data/dj/exports/${a.lastExport.file} (${mmss(a.lastExport.duration)}, ${a.lastExport.tracks} tracks)` : `   last export failed: ${a.lastExport.error}`);
      if (a.stopped?.entries != null) console.log(`   saved: ${mmss(a.stopped.duration)}, ${a.stopped.entries} moves`);
      if (take) console.log(`   recording: ${mmss(take.duration)}, ${take.entries} moves on ${take.lanes.length} lane${take.lanes.length === 1 ? '' : 's'} (${take.lanes.join(' ')})`);
      else if (st) console.log('   no recording yet: dj automation record');
    },

    async monitor() {
      const show = async () => {
        const m = await api('/api/monitor');
        if (JSON_OUT) return out(m);
        if (!m.ts) return console.log('monitor: no engine state yet');
        console.log(`MONITOR  audible: ${m.audible.join(', ') || '—'}${m.transition ? `  (critiquing transition ${m.transition.style})` : ''}`);
        for (const [n, d] of Object.entries(m.decks || {})) console.log(`  ${n}  key ${d.effectiveKey ?? '?'}  section ${d.section ?? '?'}  vocals ${d.inVocal == null ? 'n/a (no vocal map)' : d.inVocal ? (d.vocalsUp ? 'SINGING' : 'in section, muted') : 'none'}  harmonic ${d.harmonic ? 'up' : 'down'}${d.lowEnergy ? '  low-energy' : ''}  audible ${d.audible}`);
        const c = m.checks || {};
        if (c.phase) console.log(`  phase ${c.phase.decks.join('/')}: ${c.phase.offsetMs == null ? 'n/a' : c.phase.offsetMs + ' ms'}  tempo diff ${c.phase.bpmDiffPct}%`);
        if (c.key) console.log(`  keys ${c.key.a} / ${c.key.b}: ${['same', 'neighbour', 'energy boost', 'CLASH'][c.key.distance] ?? '?'}`);
        if (c.peakDb != null) console.log(`  master peak ${c.peakDb} dBFS`);
        if (c.limiting != null) console.log(`  master limiter ${c.limiting ? `taking ${c.limiting} dB off` : 'idle'}`);
        if (c.dipBars) console.log(`  low energy for ${c.dipBars} bars`);
        const w = warnLines(m);
        console.log(w.length ? w.join('\n') : '✓ no warnings');
        if (m.recent?.length) console.log(`  recent: ${m.recent.slice(-5).map((x) => `${new Date(x.ts).toLocaleTimeString()} ${x.type}`).join(' · ')}`);
      };
      const n = Number(flags.watch || 0);
      await show();
      for (let i = 1; i < n; i++) { await new Promise((r) => setTimeout(r, 1000)); console.log('—'); await show(); }
    },

    async rate() {
      const rating = rest[0];
      if (!['good', 'bad'].includes(rating)) fail('usage: dj rate good|bad [note]');
      const r = await api('/api/rate', { rating, note: rest.slice(1).join(' ') || undefined });
      if (JSON_OUT) return out(r);
      if (!r.ok) fail(r.error);
      console.log(`✓ rated ${r.entry.type} ${nm(r.entry.from)} → ${nm(r.entry.to)} ${rating}${r.entry.style ? ` (${r.entry.style} ${r.entry.bars ?? ''} bars)` : ''}`);
    },

    async memory() {
      const r = await api('/api/memory?n=' + (flags.n || 10));
      if (JSON_OUT) return out(r);
      console.log(`Set memory: ${r.total} transition(s)/mashup(s) recorded`);
      const line = (p) => `  ${p.score >= 0 ? '+' : ''}${p.score}  ${nm(p.from)} → ${nm(p.to)}  (${p.n}×${p.good ? ` 👍${p.good}` : ''}${p.bad ? ` 👎${p.bad}` : ''}${p.warnings ? ` ⚠${p.warnings}` : ''}; ${p.styles.join('/') || p.type})${p.notes.length ? ' “' + p.notes.slice(-1)[0] + '”' : ''}`;
      const top = r.pairs.filter((p) => p.score > 0).slice(0, 8), bottom = r.pairs.filter((p) => p.score < 0).slice(-8).reverse();
      console.log('TOP pairings'); console.log(top.length ? top.map(line).join('\n') : '  (none rated good yet)');
      console.log('BOTTOM pairings'); console.log(bottom.length ? bottom.map(line).join('\n') : '  (none rated bad / warned yet)');
      if (r.recent.length) {
        console.log('RECENT');
        for (const e of r.recent) console.log(`  ${new Date(e.ts).toLocaleTimeString()}  ${e.type === 'mashup' ? 'mashup' : e.style}${e.auto ? ' 🤖' : ''}  ${nm(e.from)} → ${nm(e.to)}  ${e.verdict || ''}${e.warnings?.length ? ' ⚠ ' + e.warnings.join(',') : ''}${e.rating ? ' ' + (e.rating === 'good' ? '👍' : '👎') : ''}`);
      }
    },

    // key-aware + memory-aware suggestions (--from, --direction, --limit, --bpm, --mashup, --keylock)
    async suggest() {
      const q = new URLSearchParams();
      if (flags.from || rest[0]) q.set('from', flags.from || rest[0]);
      for (const k of ['direction', 'limit', 'bpm']) if (flags[k]) q.set(k, flags[k]);
      if (flags.keylock) q.set('keylock', flags.keylock === 'off' ? '0' : '1');
      if (flags.mashup) q.set('mashup', '1');
      const r = await api('/api/suggest?' + q);
      if (JSON_OUT) return out(r);
      if (!Array.isArray(r) || !r.length) return console.log(flags.mashup ? 'No mashup pairs (needs vocal maps: dj stems status)' : 'No suggestions (is anything playing? pass --from <trackId>)');
      if (flags.mashup) {
        for (const p of r) console.log(`score ${p.score}  VOCAL ${p.vocal.id} ${nm(p.vocal)} (${p.vocal.bpm}, ${p.vocal.camelot})  over  BED ${p.bed.id} ${nm(p.bed)} (${p.bed.bpm}, ${p.bed.camelot})\n          vocal plays as ${p.effectiveKey}${p.recommendedKeyShift ? `, keyShift ${p.recommendedKeyShift > 0 ? '+' : ''}${p.recommendedKeyShift} (dj key <deck> ${p.recommendedKeyShift})` : ''}: ${p.reasons.join(', ')}`);
        return;
      }
      for (const t of r) {
        const ks = t.recommendedKeyShift ? `  → keyShift ${t.recommendedKeyShift > 0 ? '+' : ''}${t.recommendedKeyShift} (${t.shiftedKey}): dj key <deck> ${t.recommendedKeyShift}` : '';
        console.log(fmtTrack(t, `${t.effectiveKey ? `\n          plays as ${t.effectiveKey}${ks}` : ''}\n          score ${t.score}: ${t.reasons.join(', ')}`));
      }
    },

    async export() {
      const { exportSession } = await import('../../server/lib/export.mjs');
      const root = path.join(DJ_DIR, 'sessions');
      if (!fs.existsSync(root)) fail('no sessions recorded yet (dj record start)');
      const id = rest[0] || fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'session.json'))).sort().pop();
      if (!id || !fs.existsSync(path.join(root, id))) fail(`no session "${id}"`);
      const format = flags.format === 'm4a' ? 'm4a' : 'mp3';
      console.log(`⏳ exporting ${id} → ${format} …`);
      let r;
      try { r = await exportSession(path.join(root, id), { format, outDir: EXPORTS_DIR, libraryFile: path.join(CACHE_DIR, 'library.json'), log: (s) => console.log('  ' + s) }); }
      catch (e) { fail(e.message); }
      if (JSON_OUT) return out(r);
      console.log(`✓ ${r.audio}  (${mmss(r.duration)}, ${r.tracks.length} tracks from ${r.source}${r.gaps.length ? `, ${r.gaps.length} recorder gap(s)` : ''})`);
      console.log(`  tracklist ${r.txt}\n  cue sheet ${r.cue}`);
      for (const t of r.tracks) console.log(`  ${mmss(t.at)}  ${nm(t)}`);
    },
  };
};
