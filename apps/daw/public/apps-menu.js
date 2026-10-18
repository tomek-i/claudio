// The Apps menu in the header: the four apps of the suite (DJ Claude, Claude-808, MiniClaude, Claudebase), with a
// dot for each one that is running. The same file is in each app (apps/web/public/ui, apps/drums/public,
// apps/synth/public, apps/daw/public): the apps import nothing from each other, so each has its own copy, and
// test/apps-menu.test.mjs keeps the copies the same. It brings its own styles, on each page's colour tokens, under
// class names of its own (apps-, am-) that no page uses.
//
//   mountAppsMenu(button, 'drums')     the header's button, and which app this page is
// The button is the app-switcher icon (nine dots), last in each page's header, and is named "Apps" for screen readers
// (a button with text of its own gets the icon in front of it).
//
// Whether an app runs is asked of its server, GET /api/ping on its usual port (each server answers it, open to the
// other pages). A click on another app opens it in a new tab; in Claudio, the desktop suite, that opens the app's
// window, and starts it when it is not running. In a browser a page cannot start a server, so an app that is not
// running offers its start command to copy instead.
export const APPS = [
  { id: 'dj', name: 'DJ Claude', what: 'decks', port: 4747, start: 'pnpm start', color: '#ff7a45' },
  { id: 'drums', name: 'Claude-808', what: 'drums', port: 4748, start: 'pnpm drums', color: '#ffb347' },
  { id: 'synth', name: 'MiniClaude', what: 'synth', port: 4749, start: 'pnpm synth', color: '#36d6e7' },
  { id: 'daw', name: 'Claudebase', what: 'DAW', port: 4750, start: 'pnpm daw', color: '#9be564' },
];

const IN_SUITE = /\bElectron\//.test(navigator.userAgent); // Claudio's windows: it starts an app when it is opened
const CSS = `
.apps-menu { position: fixed; z-index: 1000; min-width: 250px; padding: 6px; background: var(--panel2, #181820); border: 1px solid var(--line, #262631);
  border-radius: 9px; box-shadow: 0 14px 34px rgba(0, 0, 0, .55); font: 500 13px var(--sans, system-ui, sans-serif); color: var(--text, #ecebf2); }
.apps-menu[hidden] { display: none; }
.apps-menu a { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; color: inherit; text-decoration: none; cursor: pointer; outline: none; }
.apps-menu a:hover, .apps-menu a:focus-visible { background: var(--panel, #121218); }
.apps-menu a[aria-current] { cursor: default; }
.apps-menu .am-sw { width: 4px; align-self: stretch; border-radius: 2px; background: var(--c); }
.apps-menu .am-nm { flex: 1; }
.apps-menu .am-nm small { display: block; margin: 0; color: var(--faint, #7f7e92); font: 400 11px var(--sans, system-ui, sans-serif); letter-spacing: 0; text-transform: none; }
.apps-menu .am-st { display: flex; align-items: center; gap: 6px; color: var(--faint, #7f7e92); font-size: 11px; white-space: nowrap; }
.apps-menu .am-st::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--line, #262631); }
.apps-menu [data-up=yes] .am-st { color: var(--ok, #7ee787); }
.apps-menu [data-up=yes] .am-st::before { background: var(--ok, #7ee787); box-shadow: 0 0 6px var(--ok, #7ee787); }
.apps-grid { display: inline-grid; grid-template-columns: repeat(3, 4px); gap: 2px; vertical-align: -2px; }
.apps-grid b { width: 4px; height: 4px; border-radius: 1px; background: currentColor; }
.apps-btn-icon { padding: 0 9px !important; }
.apps-btn-text .apps-grid { margin-right: 7px; }
.apps-menu .am-st code { font: 11px var(--mono, ui-monospace, Consolas, monospace); color: var(--dim, #a09fb0); }
`;

// is it running: its server answers, quickly
async function isUp(app) {
  try {
    const r = await fetch(`${location.protocol}//${location.hostname}:${app.port}/api/ping`, { signal: AbortSignal.timeout(800), cache: 'no-store' });
    return r.ok && (await r.json()).app === app.id;
  } catch { return false; }
}

export function mountAppsMenu(button, self) {
  if (!document.getElementById('apps-menu-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'apps-menu-css', textContent: CSS }));
  const menu = document.body.appendChild(document.createElement('nav'));
  menu.className = 'apps-menu'; menu.hidden = true; menu.setAttribute('aria-label', 'Apps');
  const label = button.textContent.trim();
  button.textContent = '';
  button.appendChild(Object.assign(document.createElement('span'), { className: 'apps-grid', innerHTML: '<b></b>'.repeat(9) })).setAttribute('aria-hidden', 'true');
  if (label) button.append(label); else button.setAttribute('aria-label', 'Apps');
  button.classList.add(label ? 'apps-btn-text' : 'apps-btn-icon');
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  const here = (a) => a.id === self;
  const url = (a) => `${location.protocol}//${location.hostname}:${a.port}/`;

  const items = APPS.map((a) => {
    const el = menu.appendChild(document.createElement('a'));
    el.dataset.id = a.id; el.style.setProperty('--c', a.color); el.tabIndex = 0;
    el.innerHTML = '<span class="am-sw"></span><span class="am-nm"></span><span class="am-st"></span>';
    el.querySelector('.am-nm').append(a.name, Object.assign(document.createElement('small'), { textContent: a.what }));
    if (here(a)) { el.setAttribute('aria-current', 'page'); el.dataset.up = 'yes'; el.querySelector('.am-st').textContent = 'this one'; }
    el.onclick = (e) => { e.preventDefault(); choose(a, el); };
    return el;
  });

  function choose(a, el) {
    if (here(a)) return close();
    if (el.dataset.up === 'yes' || IN_SUITE) { window.open(url(a), '_blank', 'noopener'); return close(); }
    navigator.clipboard?.writeText(a.start).then(() => { el.querySelector('.am-st').textContent = 'copied: run it in a terminal'; }, () => {});
  }

  async function refresh() {
    await Promise.all(APPS.filter((a) => !here(a)).map(async (a) => {
      const el = items.find((i) => i.dataset.id === a.id), up = await isUp(a);
      el.dataset.up = up ? 'yes' : 'no';
      const st = el.querySelector('.am-st');
      st.textContent = up ? 'running' : IN_SUITE ? 'not running: starts it' : '';
      if (!up && !IN_SUITE) { st.append('not running: '); st.appendChild(Object.assign(document.createElement('code'), { textContent: a.start })); el.title = `Click to copy "${a.start}", then run it in a terminal`; }
      else el.title = up ? `Open ${a.name}` : `Start ${a.name} and open it`;
    }));
  }

  function place() {
    const r = button.getBoundingClientRect(), w = Math.max(menu.offsetWidth, 250);
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8)))}px`;
  }
  function open() {
    menu.hidden = false; button.setAttribute('aria-expanded', 'true'); place();
    (items.find((i) => !i.hasAttribute('aria-current')) || items[0]).focus();
    refresh();
  }
  function close() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }

  button.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) open(); else close(); });
  // Space and Enter on the button are the button's (on Claude-808, Space on the page is play)
  button.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== button && !button.contains(e.target)) close(); });
  addEventListener('resize', () => { if (!menu.hidden) place(); });
  // the menu's keys go no further (the pages listen on the window, for Space, the arrows, letters): Escape closes it,
  // the arrows move between the apps, Enter or Space opens one; Tab leaves it as anywhere else
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') return close();
    e.stopPropagation();
    const at = items.indexOf(document.activeElement), step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (e.key === 'Escape') { close(); button.focus(); }
    else if (step) { e.preventDefault(); items[(at + step + items.length) % items.length].focus(); }
    else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) { e.preventDefault(); choose(APPS[at], items[at]); }
  });
  return { open, close, refresh };
}
