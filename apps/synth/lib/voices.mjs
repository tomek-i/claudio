// Eight voices. A ninth note takes one away from a note that is sounding. Which one is decided here, on times
// alone, so that live playing (where "now" moves) and the offline render (where every note is laid out before
// any of it is heard) choose the same way.
//
// A voice here is { start, releaseAt, end }: when its note began, when its key was let go (Infinity while held)
// and when it is silent (Infinity while held).
export const MAX_VOICES = 8;

// The voice to cut short for a note that starts at `time`, or null when there is room. A voice that has been let
// go and is dying away goes first (the one let go longest ago); otherwise the oldest note goes.
export function voiceToSteal(voices, time, max = MAX_VOICES) {
  const sounding = voices.filter((v) => v.end > time);
  if (sounding.length < max) return null;
  const released = sounding.filter((v) => v.releaseAt <= time);
  if (released.length) return released.reduce((a, b) => (b.releaseAt < a.releaseAt ? b : a));
  return sounding.reduce((a, b) => (b.start < a.start ? b : a));
}
