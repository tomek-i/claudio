# Visuals for a second screen

[← Back to the README](../README.md)

`http://<this machine>:4747/visuals` is a full-screen visualiser that reacts to the live set: for a projector behind
the decks, a second monitor, or someone's phone. The server prints the address with this machine's network address
when it starts, and `dj visuals` shows it again. The page only watches; it has no deck controls.

- **Modes**: spectrum tunnel, particle field, reactive terrain, kaleidoscope. **Auto** (the default) moves between
  them on musical boundaries (a new track, a breakdown, the start of a phrase), over several bars. Between the tunnel,
  the particle field and the terrain the change is a morph: the same points of light fly from one shape into the
  other. A change into or out of the kaleidoscope, which is a full-screen shader with no shape, crossfades.
  Pick one on the page (move the pointer for the overlay, or keys `1`-`4`, `A` for auto), by address
  (`/visuals?mode=tunnel`), or from the booth for every open page: `dj visuals <mode|auto>`.
- **Colour follows the track**: the hue is the key's colour as on the deck's key chip, the accent is the deck colour,
  and both move from one track to the next as the mix does. Energy and structure set how intense it is.
- **Sound, if wanted**: the page is silent until a viewer turns the sound on (the Sound button, `S`, or
  `/visuals?audio=1` and one click). The viewer then hears the set a second or two behind the decks, and the picture
  is locked to what that viewer hears. With the sound off the picture runs as close to live as it can, for a screen
  in the room; `/visuals?offset=<ms>` or the `←` `→` keys shift it for a slow projector. The `visuals.audio` setting
  switches the sound off for everyone.
- **Low-latency sound** (the `visuals.lowLatency` setting, off by default for now): on the same network the sound
  goes straight from the DJ page to the viewer over WebRTC, about a tenth of a second behind the decks instead of
  a second or two. No audio passes through the server on that path and nothing outside the network is contacted.
  It is tried first; a viewer it cannot reach within three seconds, or one beyond `visuals.maxListeners` (8), hears
  the set through the server as before, and the overlay says which way the sound is coming.
- **Quality**: the morphing modes draw 250 thousand, 1 million or 4 million points (low, medium, high). The page
  picks a tier for the graphics card when it starts and steps down one if it cannot hold the frame rate;
  `/visuals?quality=low|medium|high` fixes it.
- **Needs WebGPU** (a current Chrome or Edge). It is drawn with three.js, vendored in `apps/web/public/vendor/three/`; there is
  no WebGL fallback, and a browser without WebGPU gets a message saying so.

The engine tab measures the sound and encodes audio only while someone is watching or listening. `/health` shows both
streams.
