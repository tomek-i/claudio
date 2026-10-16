# Starter crate

Twelve openly licensed tracks so a fresh checkout has something to mix. `node dj.mjs demo` downloads them from
[Free Music Archive](https://freemusicarchive.org) into `data/dj/library/demo/` (each file is checked against the hash in
`tracks.json`); `node dj.mjs demo --list` shows them without downloading.

The audio is not part of this repository. Every track was published by its artist under a Creative Commons licence
that allows sharing, remixing and commercial use. BPM values are approximate; the analyser measures the real ones.

| Genre | ~BPM | Track | Artist | Licence |
|---|---|---|---|---|
| Hip-Hop | 95 | [Unwind](https://freemusicarchive.org/music/holiznacc0/kick-it-laid-back-hiphop/unwind/) | HoliznaCC0 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Hip-Hop | 113 | [WOLF](https://freemusicarchive.org/music/holiznacc0/after-dark/wolf-1/) | HoliznaCC0 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Phonk | 113 | [ONLY HUMAN](https://freemusicarchive.org/music/holiznacc0/phonk-aura-farming/only-human/) | HoliznaCC0 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Rap | 86 | [Gang Green by Ketsa X TCC](https://freemusicarchive.org/music/Ketsa/concrete-flowers/gang-green-by-ketsa-x-tcc/) | Ketsa | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Rap | 130 | [No Time by Ketsa x The Conscious MC](https://freemusicarchive.org/music/Ketsa/concrete-flowers/no-time-by-ketsa-x-the-conscious-mc/) | Ketsa | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| House | 123 | [Clone](https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-dancehouse-instrumentals/clone/) | 1000 Handz | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| House | 126 | [Take You Higher](https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-dancehouse-instrumentals/take-you-higher/) | 1000 Handz | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| House | 125 | [Unity](https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-drum-bass-instrumentals/unity-1/) | 1000 Handz | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Bass / EDM | 135 | [Statik](https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-electronicgaming-instrumentals/statik/) | 1000 Handz | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Techno | 136 | [Back To Work](https://freemusicarchive.org/music/Six_Umbrellas/back-to-work/back-to-work/) | Six Umbrellas | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Drum & Bass | 171 | [Pulse Logic](https://freemusicarchive.org/music/Six_Umbrellas/back-to-work/pulse-logic/) | Six Umbrellas | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Drum & Bass | 179 | [Superwave](https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-drum-bass-instrumentals/superwave/) | 1000 Handz | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## If you publish a mix
- **CC0** tracks need no credit.
- **CC BY** tracks need a credit: artist, title, licence and a link (the table above has all four).
- **CC BY-SA** tracks need the same credit, and a mix that contains them has to be shared under CC BY-SA too.

## Adding a track
Add an entry to `tracks.json` with the Free Music Archive track page as `source`, the direct file as `url`, and the
file's `bytes` and `sha256`. Only use tracks under CC0, CC BY or CC BY-SA; the NC and ND variants do not allow
remixing or free reuse.
