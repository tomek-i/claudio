// A hand on a deck: the scratch and nudge gestures, shared by the jog wheel and the waveform so both feel the same.
// Scratching drives the engine's grab() / handMove() / release(); a nudge bends the rate and lets it settle back.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const coasting = new Map(); // deck -> animation frame of a thrown waveform still running down

// take hold of a deck to scratch it. A deck that is coasting from a throw is caught where it is; a deck another
// control already holds is not taken (false).
export function takeHold(d) {
  if (coasting.has(d)) { cancelAnimationFrame(coasting.get(d)); coasting.delete(d); return true; }
  return d.grab();
}
// stop a throw that is still running down, where it is (before the deck is moved some other way)
export function stopCoast(d) { if (coasting.has(d)) { cancelAnimationFrame(coasting.get(d)); coasting.delete(d); d.release(); } }
// move the held deck by dSec of track over dt seconds
export function scratchBy(d, dSec, dt) { d.handMove(dSec, clamp(dSec / dt, -12, 12)); }
// let go. With `inertia`, a deck released while moving at `vel` (track seconds per second) keeps travelling and
// runs down to rest, or to its playing speed if it was playing, like a jog wheel that was spun.
export function letGo(d, vel = 0, inertia = false) {
  const target = d.hand?.wasPlaying ? d.rate : 0;
  if (!inertia || Math.abs(vel - target) < 0.3) return d.release();
  let v = clamp(vel, -12, 12), last = performance.now();
  const step = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    v = target + (v - target) * Math.exp(-dt / 0.22);
    d.handMove(v * dt, v);
    if (Math.abs(v - target) < 0.05) { coasting.delete(d); d.release(); return; }
    coasting.set(d, requestAnimationFrame(step));
  };
  coasting.set(d, requestAnimationFrame(step));
}
// a nudge: by(x) bends the rate by x (±12 % at most) while the deck plays, end() puts the rate back
export function bend(d) {
  const base = d.rate;
  return { by(x) { if (d.playing) d.setRate(base * (1 + clamp(x, -0.12, 0.12))); }, end() { d.setRate(base); } };
}
// silence a deck while its playhead is moved without scratch audio, and bring it back
export function hush(d, on) {
  const g = d.cut.gain, now = d.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(on ? 0 : 1, on ? now : now + 0.03, 0.004);
}
