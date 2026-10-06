import { $, $$ } from './util.js';

// ------------------------------------------------------------------ decks C + D: cloned from A/B, hidden until loaded
(function buildExtraDecks() {
  for (const [n, tpl] of [['C', 'A'], ['D', 'B']]) {
    const el = $(`.deck[data-deck="${tpl}"]`).cloneNode(true);
    el.dataset.deck = n; el.classList.add('compact');
    $('.deck-letter', el).textContent = n;
    $('#rig2').append(el);
    const st = $(`.strip[data-deck="${tpl}"]`).cloneNode(true);
    st.dataset.deck = n; st.classList.add('extra');
    $('.sname', st).textContent = n;
    if (n === 'C') $('.strips').prepend(st); else $('.strips').append(st);
  }
  for (const el of $$('.deck')) $('.xfa', el).value = el.dataset.deck === 'A' || el.dataset.deck === 'C' ? 'left' : 'right';
})();
