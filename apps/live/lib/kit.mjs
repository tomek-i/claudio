// The drum kit: the voices a drum track has, in the order of the rows, and the velocity levels a step is written
// with. A copy of Claudebase's (apps/daw/lib/kit.mjs), as the apps import nothing from each other; served as
// /lib/kit.mjs.

export const VOICES = [
  { id: 'kick', name: 'Kick', midi: 36 },
  { id: 'snare', name: 'Snare', midi: 38 },
  { id: 'clap', name: 'Clap', midi: 39 },
  { id: 'hat', name: 'Hat', midi: 42 },
  { id: 'open', name: 'Open hat', midi: 46 },
  { id: 'tom', name: 'Tom', midi: 45 },
  { id: 'rim', name: 'Rim', midi: 37 },
  { id: 'bell', name: 'Cowbell', midi: 56 },
];

export const VOICE_IDS = VOICES.map((v) => v.id);

// other names a row can be written under (`claudebase drums c1 "hihat x.x.x.x.x.x.x.x."`)
const ALIASES = {
  bd: 'kick', sd: 'snare', sn: 'snare', cp: 'clap', hh: 'hat', hihat: 'hat', hats: 'hat', ch: 'hat',
  oh: 'open', ohat: 'open', openhat: 'open', toms: 'tom', lt: 'tom', mt: 'tom', ht: 'tom', rimshot: 'rim', rs: 'rim', cowbell: 'bell', cb: 'bell',
};

export function voiceId(name) {
  const key = String(name).toLowerCase().replace(/[^a-z]/g, '');
  if (VOICE_IDS.includes(key)) return key;
  if (ALIASES[key]) return ALIASES[key];
  throw new Error(`no drum called "${name}" (the kit has: ${VOICE_IDS.join(', ')})`);
}

// A step's velocity is any number from 0 (off) to 1; these are the four the grid writes, and their letters.
export const LEVELS = { ghost: 0.3, soft: 0.55, normal: 0.8, accent: 1 };
export const LEVEL_NAMES = Object.keys(LEVELS);
const LETTERS = { g: 'ghost', o: 'soft', x: 'normal', X: 'accent' };

export function levelOf(vel) {
  if (!(vel > 0)) return null;
  return LEVEL_NAMES.reduce((best, name) => (Math.abs(LEVELS[name] - vel) < Math.abs(LEVELS[best] - vel) ? name : best));
}

export function letterOf(vel) {
  const level = levelOf(vel);
  return level ? Object.keys(LETTERS).find((l) => LETTERS[l] === level) : '.';
}

export function velOfLetter(letter) {
  if (letter === '.' || letter === '-') return 0;
  if (LETTERS[letter]) return LEVELS[LETTERS[letter]];
  throw new Error(`"${letter}" is not a step ( . off, g ghost, o soft, x normal, X accent )`);
}
