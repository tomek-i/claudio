// dj CLI extension: the /visuals page (a full-screen visualiser for a second screen or a projector).
//   dj visuals                 who is watching, which mode, the address to open
//   dj visuals <mode|auto>     change the mode on every open visuals page
export default ({ api, rest, fail, out, JSON_OUT }) => ({
  async visuals() {
    const mode = rest[0];
    if (mode) {
      const r = await api('/api/visuals/mode', { mode });
      if (JSON_OUT) return out(r);
      if (!r.ok) return fail(r.error || 'could not change the mode');
      return console.log(`✓ visuals: ${r.mode}${r.viewers ? ` on ${r.viewers} page${r.viewers === 1 ? '' : 's'}` : ' (no page is open yet)'}`);
    }
    const s = await api('/api/visuals');
    if (JSON_OUT) return out(s);
    console.log(`Visuals: mode ${s.mode} · ${s.viewers} page${s.viewers === 1 ? '' : 's'} open${s.viewers ? ` · ${s.fps} frames a second from the engine` : ''}`);
    console.log(`  open ${s.url} on any device on this network`);
    console.log(`  modes: auto, ${s.modes.join(', ')}`);
  },
});
