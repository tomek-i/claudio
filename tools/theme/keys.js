// The Keys dialog of Claude-808, MiniClaude and Claudebase: the page's keyboard shortcuts and mouse gestures in one
// list, opened from the "⌨ Keys" button in the header, as the DJ page's is. This is the one copy to change: it is part
// of the theme (tools/theme/), which `node tools/theme.mjs` copies into each app's public/theme/. Its styles are the
// theme's (.keys-*, in theme.css).
//
//   mountKeys(button, [{ title: 'Anywhere', rows: [['Play / stop', 'Space'], ['Undo', 'Ctrl+Z'], …] }, …])
//
// The keys of a row are shown as written: each part joined by + is a <kbd> of its own ("Ctrl+Shift+Z" is three), and
// " / " or " or " between alternatives stays text. Esc, Close or a click outside the card closes it. While it is open no key reaches the page:
// the pages listen on the window (Space plays, letters play notes), and a list of keys should not play them. A key
// let go still does, so a note held when the dialog opened is not left sounding.
export function mountKeys(button, groups) {
  const box = document.body.appendChild(document.createElement('div'));
  box.className = 'keys-overlay';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'keysTitle');

  const card = box.appendChild(document.createElement('div'));
  card.className = 'keys-card';
  card.tabIndex = -1;   // a click on its text keeps the focus in the dialog
  const add = (parent, tag, props = {}) => parent.appendChild(Object.assign(document.createElement(tag), props));
  add(card, 'h2', { id: 'keysTitle', textContent: 'Keys and gestures' });
  for (const group of groups) {
    add(card, 'h3', { textContent: group.title });
    const table = add(card, 'table');
    for (const [what, keys] of group.rows) {
      const tr = add(table, 'tr');
      add(tr, 'td', { textContent: what });
      const td = add(tr, 'td');
      // "Ctrl+Shift+Z" → three keys; " / " and " or " between alternatives stay as text
      for (const part of keys.split(/( \/ | or |\+)/)) {
        if (part === '+') td.append('+');
        else if (part === ' / ' || part === ' or ') td.append(part);
        else add(td, 'kbd', { textContent: part });
      }
    }
  }
  const closeBtn = add(card, 'button', { type: 'button', textContent: 'Close', title: 'Close the list (Esc)' });

  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  let back = null;   // where the focus was, to put it back
  function onKey(e) {
    e.stopPropagation();
    if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus({ preventScroll: true }); return; }   // the focus stays in the dialog: Close is its one stop
    if (e.key === 'Escape' || ((e.key === 'Enter' || e.key === ' ') && document.activeElement === closeBtn)) { e.preventDefault(); close(); }
    else if (e.key === ' ') e.preventDefault();   // no scrolling, no click on something behind
  }
  function open() {
    back = document.activeElement;
    box.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    addEventListener('keydown', onKey, true);   // the capture phase on the window: before any page's own listener
    card.scrollTop = 0;
    closeBtn.focus({ preventScroll: true });   // a long list opens at its top, not scrolled down to Close
  }
  function close() {
    box.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    removeEventListener('keydown', onKey, true);
    (back && back !== document.body ? back : button).focus();
  }

  button.addEventListener('click', () => (box.hidden ? open() : close()));
  // Space and Enter on the button are the button's (Space on the page is play)
  button.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
  closeBtn.addEventListener('click', close);
  box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
  return { open, close };
}
