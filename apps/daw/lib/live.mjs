// The live loop of the /live page: the blocks of code (lib/pattern.mjs) playing bar after bar, new code coming in on
// a bar line, never inside a bar, and the blocks that are heard (muted, soloed). Also the code as a link. No page in
// here, so test/live.test.mjs tests it in plain Node; public/live.js plays what it gives.
import { query } from './pattern.mjs';

// the blocks heard: those soloed if any are, else those not muted (in the code with _, or by hand)
export function heardBlocks(blocks, { muted = new Set(), soloed = new Set() } = {}) {
  const solo = blocks.some((b) => soloed.has(b.name));
  return blocks.filter((b) => (solo ? soloed.has(b.name) : !b.muted && !muted.has(b.name)));
}

export class Loop {
  constructor() {
    this.blocks = [];      // what plays now
    this.next = null;      // { blocks, at }: what plays from bar `at` on
  }

  // new blocks from bar `at` (a whole number); with nothing playing yet, at once
  set(blocks, at = null) {
    if (at === null || !this.blocks.length) { this.blocks = blocks; this.next = null; }
    else this.next = { blocks, at };
  }

  // the blocks of bar `bar`
  blocksAt(bar) { return this.next && bar >= this.next.at ? this.next.blocks : this.blocks; }

  // the events that start in [from, to) of the blocks heard, each with the name of its block (and the block itself,
  // as source). It changes nothing, so the page can ask for the bars it draws as well as the ones it plays.
  events(from, to, heard = {}) {
    const out = [];
    const cut = this.next && this.next.at > from && this.next.at < to ? this.next.at : null;
    for (const [a, b] of cut === null ? [[from, to]] : [[from, cut], [cut, to]]) {
      for (const block of heardBlocks(this.blocksAt(Math.floor(a + 1e-9)), heard)) {
        for (const ev of query(block.pattern, a, b)) out.push({ ...ev, block: block.name, source: block });
      }
    }
    return out.sort((x, y) => x.start - y.start);
  }

  // played up to `to`: the new blocks take over once their bar has come
  advance(to) {
    if (this.next && to >= this.next.at) { this.blocks = this.next.blocks; this.next = null; }
  }
}

// The bar the next code comes in on, given how far the loop has been scheduled: the next bar line after it.
export const nextBar = (scheduled) => Math.floor(scheduled + 1e-9) + 1;

// The code in a link (#code=…), as Strudel puts it in its URL: UTF-8, then base64 for URLs.
export function codeToHash(code, bpm) {
  const bytes = new TextEncoder().encode(code);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const params = new URLSearchParams({ bpm: String(bpm), code: btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') });
  return `#${params}`;
}

// { code, bpm } from a link's #…, or null when it holds none
export function hashToCode(hash) {
  const params = new URLSearchParams(String(hash).replace(/^#/, ''));
  const enc = params.get('code');
  if (!enc) return null;
  try {
    const bin = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
    const code = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const bpm = Number(params.get('bpm'));
    return { code, bpm: bpm >= 40 && bpm <= 240 ? bpm : null };
  } catch { return null; }
}
