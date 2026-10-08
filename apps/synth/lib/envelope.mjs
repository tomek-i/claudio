// An envelope: { attack, decay, sustain, release }, times in seconds, sustain 0..1. The level rises in a straight
// line to 1 over the attack, falls towards the sustain level, and when the key is let go falls to nothing.
//
// The two falls are exponential, which is what Web Audio's setTargetAtTime draws, so the level worked out here is
// the level the audio engine is at. The engine needs that when a key is let go (the release starts from where
// the envelope is, not from where it would have been) and the page draws the envelope with it.

// A fall has covered 98% of its distance after its time: the time constant is a quarter of it.
export const tau = (seconds) => Math.max(0.001, seconds) / 4;

function heldLevel({ attack, decay, sustain }, t) {
  if (t < attack) return t / attack;
  return sustain + (1 - sustain) * Math.exp(-(t - attack) / tau(decay));
}

// The level `t` seconds after the key went down, the key having been let go after `held` seconds (Infinity
// while it is still down).
export function envLevel(env, t, held = Infinity) {
  if (!(t > 0)) return 0;
  if (t <= held) return heldLevel(env, t);
  return heldLevel(env, Math.max(0, held)) * Math.exp(-(t - held) / tau(env.release));
}

// When a voice let go after `held` seconds can be thrown away: two release times on, it is 70 dB down.
export const envEnd = (env, held) => held + env.release * 2 + 0.02;
