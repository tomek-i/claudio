// Two channels of samples (−1..1) as a 16-bit stereo WAV file.
export function encodeWav(left, right, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + left.length * 4));
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + left.length * 4, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, left.length * 4, true);
  for (let i = 0; i < left.length; i++) {
    view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return view.buffer;
}
