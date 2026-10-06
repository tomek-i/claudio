// dj CLI extension: hide or show the lower row (crate + booth) on every open DJ page.
//   dj crate hide | show | toggle      e.g. hide it before recording the decks
// It is the ui.lowerCollapsed setting, so the page's own toggle and /settings stay in step with it.
export default ({ api, rest, fail, out, JSON_OUT }) => ({
  async crate() {
    const what = rest[0];
    if (!['hide', 'show', 'toggle'].includes(what)) return fail('usage: dj crate hide|show|toggle');
    const key = 'ui.lowerCollapsed';
    const now = (await api('/api/settings')).fields.find((f) => f.key === key).value;
    const collapsed = what === 'toggle' ? !now : what === 'hide';
    const r = await api('/api/settings', { [key]: collapsed });
    if (r.ok === false) return fail(Object.values(r.errors || {})[0] || 'could not change the setting');
    if (JSON_OUT) return out({ ok: true, collapsed });
    console.log(`✓ crate and booth ${collapsed ? 'hidden' : 'shown'}${collapsed === now ? ' (already)' : ''}`);
  },
});
