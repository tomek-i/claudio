// "Back to the decks" on the pages the DJ page opens in a tab or window of their own (/health, /settings).
// The decks are still open where the user came from, so going back is closing this one. Loading the DJ page here
// instead would make a second one, which is not the sound system. Only when no DJ page is the engine (this page was
// opened by its address, or the decks were closed since) does the link load it, as a plain link would.
for (const a of document.querySelectorAll('a[data-back]')) {
  a.addEventListener('click', async (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    let decksOpen = false;
    try { decksOpen = !!(await (await fetch('/api/state', { signal: AbortSignal.timeout(1500) })).json()).engine?.connected; } catch { /* no answer: load the page */ }
    if (decksOpen) {
      window.close();
      // a browser refuses to close a tab the user opened by hand: say where the decks are, and leave this page as it is
      setTimeout(() => { a.textContent = 'The decks are open in another tab'; }, 300);
    } else location.href = a.href;
  });
}
