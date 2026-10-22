// Each app's icon, as its page draws it (the favicons: apps/web/public/index.html, apps/drums|synth|daw|live/public/
// index.html), larger, with the parts that move: the record shines as it turns, the meter jumps, the wave runs, the
// playhead crosses the clips, the loop turns. Shared by the home window (they play while a card is hovered) and the
// start-up window (they play while the app starts: .play). At rest each is the icon as the app draws it.
const svg = (box, body) => `<svg viewBox="0 0 ${box} ${box}" aria-hidden="true">${body}</svg>`;
const ART = {
  dj: svg(32, `<circle cx="16" cy="16" r="14" fill="#111"/><path class="sheen" d="M7 9 A11.5 11.5 0 0 1 13 4.8 M25 23 A11.5 11.5 0 0 1 19 27.2" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="9" fill="none" stroke="#ff7a45" stroke-width="2"/><circle cx="16" cy="16" r="2.5" fill="#36d6e7"/>`),
  drums: svg(16, `<g class="meter"><rect width="16" height="16" rx="3" fill="#09090c"/><rect x="2" y="9" width="3" height="5" fill="#ff7a45"/><rect x="7" y="4" width="3" height="10" fill="#36d6e7"/><rect x="12" y="7" width="3" height="7" fill="#9be564"/></g>`),
  synth: svg(16, `<defs><clipPath id="wave-in"><rect x="2" y="0" width="12" height="16"/></clipPath></defs><rect width="16" height="16" rx="3" fill="#09090c"/><g class="wave" clip-path="url(#wave-in)"><path d="M2 11 L5 4 L8 11 L11 4 L14 11 L17 4 L20 11" fill="none" stroke="#ff7a45" stroke-width="1.8" stroke-linejoin="round"/></g>`),
  daw: svg(16, `<rect width="16" height="16" rx="3" fill="#09090c"/><rect x="2" y="3" width="8" height="3" rx="1" fill="#ff7a45"/><rect x="6" y="7" width="8" height="3" rx="1" fill="#36d6e7"/><rect x="2" y="11" width="5" height="3" rx="1" fill="#9be564"/><rect class="playhead" x="1.6" y="1.5" width=".6" height="13" rx=".3" fill="#ecebf2"/>`),
  live: svg(16, `<rect width="16" height="16" rx="3" fill="#09090c"/><g class="loop"><path d="M12.7 9.7A5 5 0 1 1 12.1 5.13" fill="none" stroke="#36d6e7" stroke-width="1.6" stroke-linecap="round"/><path d="M13 6.44 13.16 4.38 11.04 5.88Z" fill="#36d6e7"/></g><rect class="caret" x="7.2" y="5" width="1.6" height="6" rx=".5" fill="#ff7a45"/>`),
};
document.head.appendChild(document.createElement('style')).textContent = `
  .art svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .sheen { opacity: 0; transform-origin: 16px 16px; }
  :is(.app:hover, .play) .sheen { opacity: 1; animation: art-spin 1.8s linear infinite; }
  .meter rect + rect { transform-box: fill-box; transform-origin: bottom; animation: none .9s ease-in-out infinite alternate; }
  :is(.app:hover, .play) .meter rect + rect { animation-name: art-jump; }
  .meter rect:nth-child(3) { animation-delay: -.3s; } .meter rect:nth-child(4) { animation-delay: -.6s; }
  @keyframes art-jump { 0% { transform: scaleY(1); } 50% { transform: scaleY(.45); } 100% { transform: scaleY(1.1); } }
  :is(.app:hover, .play) .wave path { animation: art-run 1s linear infinite; }
  @keyframes art-run { to { transform: translateX(-6px); } }
  .playhead { opacity: 0; }
  :is(.app:hover, .play) .playhead { animation: art-playhead 2.4s linear infinite; }
  @keyframes art-playhead { 0% { transform: translateX(0); opacity: 1; } 96% { opacity: 1; } 100% { transform: translateX(12px); opacity: 0; } }
  .loop { transform-origin: 8px 8px; }
  :is(.app:hover, .play) .loop { animation: art-spin 2s linear infinite; }
  :is(.app:hover, .play) .caret { animation: art-blink 1.1s steps(1) infinite; }
  @keyframes art-spin { to { transform: rotate(360deg); } }
  @keyframes art-blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .art * { animation: none !important; } }
`;
