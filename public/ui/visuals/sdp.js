// Low-latency audio: making a WebRTC session description ask for music instead of speech.
// Left alone, a browser sends Opus in mono at a speech bitrate and stops sending in quiet passages. The Opus format
// line of both the offer (the engine tab's) and the answer (the viewer's) is rewritten to say: stereo, this bitrate,
// and no discontinuous transmission. Both sides have to say it: a sender only encodes stereo if the other side's
// description asks for it.
export function musicSdp(sdp, kbps = 160) {
  const pt = /^a=rtpmap:(\d+) opus\/48000\/2\s*$/im.exec(sdp)?.[1];
  if (!pt) return sdp;
  const want = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: String(Math.round(kbps * 1000)), usedtx: '0' };
  const line = new RegExp(`^a=fmtp:${pt} (.*)$`, 'm'), found = line.exec(sdp);
  const params = new Map((found ? found[1].trim().split(/\s*;\s*/) : []).filter(Boolean).map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv, null] : [kv.slice(0, i), kv.slice(i + 1)]; }));
  for (const [k, v] of Object.entries(want)) params.set(k, v);
  const fmtp = `a=fmtp:${pt} ${[...params].map(([k, v]) => (v == null ? k : `${k}=${v}`)).join(';')}`;
  if (found) return sdp.replace(line, fmtp);
  return sdp.replace(new RegExp(`^(a=rtpmap:${pt} opus/48000/2)(\\r?)$`, 'im'), `$1$2\n${fmtp}$2`);
}

// what the Opus format line of a description says, for checking: { stereo, maxaveragebitrate, usedtx, … } or null
export function opusParams(sdp) {
  const pt = /^a=rtpmap:(\d+) opus\/48000\/2\s*$/im.exec(sdp || '')?.[1];
  const found = pt && new RegExp(`^a=fmtp:${pt} (.*)$`, 'm').exec(sdp);
  return found ? Object.fromEntries(found[1].trim().split(/\s*;\s*/).filter(Boolean).map((kv) => kv.split('='))) : null;
}
