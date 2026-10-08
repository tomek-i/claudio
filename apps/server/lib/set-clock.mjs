// When the current set started, for the set timer in the DJ page's header. A set starts when music goes on air
// after 30 minutes or more without any (or for the first time since the server started) and ends once there has
// been none for that long: a pause, a slow change of track or a reload of the page does not start a new one.
// Pure: the server keeps the value and says what the time is.

export const SET_GAP_MS = 30 * 60 * 1000;

// set: { start, last } (ms: when the set began, when music was last on air) or null for no set.
// playing: music is on air at `now`. Returns the set as it is at `now`; the one passed in is not changed.
export function advanceSet(set, playing, now, gap = SET_GAP_MS) {
  if (set && now - set.last >= gap) set = null; // the silence was long enough to end it
  if (!playing) return set;
  return { start: set ? set.start : now, last: now };
}
