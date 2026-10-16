# Changelog

## [0.6.0](https://github.com/tomek-i/dj-claude/compare/v0.5.0...v0.6.0) (2026-10-16)


### Features

* **automation:** an Automation tab to see and edit a set's recording, and export the set ([#74](https://github.com/tomek-i/dj-claude/issues/74)) ([fd8fb1c](https://github.com/tomek-i/dj-claude/commit/fd8fb1cc2f6fd022188e62227262b3a51e0aa2d2))
* **automation:** export a set silently ([#76](https://github.com/tomek-i/dj-claude/issues/76)) ([5a94b63](https://github.com/tomek-i/dj-claude/commit/5a94b639efe26244b0629614120594a0cc3aa2a4))
* **automation:** record everything done on the decks and play it back ([#73](https://github.com/tomek-i/dj-claude/issues/73)) ([2b3706a](https://github.com/tomek-i/dj-claude/commit/2b3706ac6744636c51d05b7a0232f53e981b0e59))
* **sets:** a set keeps the decks and the mixer, and puts them back ([#72](https://github.com/tomek-i/dj-claude/issues/72)) ([c90a69d](https://github.com/tomek-i/dj-claude/commit/c90a69dc1a309b7f133282934ccfee97345fe622))
* **sets:** a Sets tab beside the library ([#77](https://github.com/tomek-i/dj-claude/issues/77)) ([0a115aa](https://github.com/tomek-i/dj-claude/commit/0a115aad2acfbe6908a8729845562312790c6ccc))
* **sets:** saved sets that Auto-DJ plays from ([#71](https://github.com/tomek-i/dj-claude/issues/71)) ([086fb3d](https://github.com/tomek-i/dj-claude/commit/086fb3df80711ebb61af7364195defca0f03835f))
* **synth:** save presets of your own, browse them all in a list, and sixteen new built-in sounds ([#79](https://github.com/tomek-i/dj-claude/issues/79)) ([4f53b08](https://github.com/tomek-i/dj-claude/commit/4f53b08aaa18dd398e20c8a9b19bb981a0bb16c1))


### Bug fixes

* **booth:** Auto-DJ lines are no longer shown as Claude ([#69](https://github.com/tomek-i/dj-claude/issues/69)) ([28b14b4](https://github.com/tomek-i/dj-claude/commit/28b14b448fbcae394d620d75e8d5ca70a14174df))
* **mixer:** +6 dB on the master and on a channel fader is real level again ([#78](https://github.com/tomek-i/dj-claude/issues/78)) ([7b5a28f](https://github.com/tomek-i/dj-claude/commit/7b5a28f3cbff6803ea807f3d90a74f7c9b1a6c41))

## [0.5.0](https://github.com/tomek-i/dj-claude/compare/v0.4.0...v0.5.0) (2026-10-08)


### Features

* **drums:** a ruler of beats above the grid, and a playhead you can see ([1175469](https://github.com/tomek-i/dj-claude/commit/11754692a729c21abc2cad55ca5335adf01557f6)), closes [#44](https://github.com/tomek-i/dj-claude/issues/44)
* **ui:** a clock and a set timer in the header ([168f5db](https://github.com/tomek-i/dj-claude/commit/168f5db7e2d74ce30cd3ef11c5be4df6d924691e)), closes [#22](https://github.com/tomek-i/dj-claude/issues/22)


### Bug fixes

* **apps:** a start card on the drum machine, the synth and the DAW instead of silent pages ([ab39028](https://github.com/tomek-i/dj-claude/commit/ab39028b9abac68a13d67fd596b5bb75de48bc6a)), closes [#38](https://github.com/tomek-i/dj-claude/issues/38)
* **drums:** the header stays on one row with the sound light in it ([9cedc11](https://github.com/tomek-i/dj-claude/commit/9cedc11efdbf657533e0b7fb24a11cb966793aa7))
* **synth:** the keyboard no longer covers the sequencer ([37438f4](https://github.com/tomek-i/dj-claude/commit/37438f43c1f772fb29967e7267d993d05663de4b)), closes [#48](https://github.com/tomek-i/dj-claude/issues/48)
* **ui:** a wider crossfader with a larger cap ([47c8b8f](https://github.com/tomek-i/dj-claude/commit/47c8b8ffd4b35eb6b31ee28046d92849e0dbabd6)), closes [#19](https://github.com/tomek-i/dj-claude/issues/19)
* **ui:** larger sampler pads and a taller chop keyboard in the bottom panel ([a6f361f](https://github.com/tomek-i/dj-claude/commit/a6f361fb097ab5e34fb3eb21f95e9e2f11085882)), closes [#18](https://github.com/tomek-i/dj-claude/issues/18)
* **ui:** library rows mark only missing stems and say which deck a track is on ([d3c45ca](https://github.com/tomek-i/dj-claude/commit/d3c45ca4ab8813b1fafa9effbe4acbd78e35556b)), closes [#17](https://github.com/tomek-i/dj-claude/issues/17)
* **ui:** the header's Keys, Visuals and Settings are buttons, and AUTO DJ off no longer looks disabled ([749c970](https://github.com/tomek-i/dj-claude/commit/749c97044dfa6da7c3dc0c708c89580c08908bd1)), closes [#20](https://github.com/tomek-i/dj-claude/issues/20)
* **ui:** the request box's hint fits beside SEND ([203889f](https://github.com/tomek-i/dj-claude/commit/203889f8c202318505701f9ca88106cd72214249))

## [0.4.0](https://github.com/tomek-i/dj-claude/compare/v0.3.0...v0.4.0) (2026-10-08)


### Features

* **daw:** Claudebase, a small DAW with drum and synth tracks ([1ef8b3a](https://github.com/tomek-i/dj-claude/commit/1ef8b3a53cadfd23ba7260bbde8149fa1297f9fc))
* **drums:** Claude-808, a drum machine Claude plays with you ([9cbb498](https://github.com/tomek-i/dj-claude/commit/9cbb4983668abc809ca8e345221836a107a43379))
* **synth:** MiniClaude, a polyphonic synthesizer with a step sequencer ([7d79b32](https://github.com/tomek-i/dj-claude/commit/7d79b32656f4919cd21c0f80ab8ef523fd2a0da3))

## [0.3.0](https://github.com/tomek-i/dj-claude/compare/v0.2.0...v0.3.0) (2026-10-08)


### Features

* **desktop:** a start-up window, a dark frame, the logo as the icon, and a maximised start ([be8bb33](https://github.com/tomek-i/dj-claude/commit/be8bb337e4700fdf5f743e26809d70eabef3ef11))
* **desktop:** an installer for the desktop app ([9546531](https://github.com/tomek-i/dj-claude/commit/9546531d5859e74313623a85cfa53d8fa502e72d))
* **desktop:** the DJ window opens where it was last closed ([a8e1d0d](https://github.com/tomek-i/dj-claude/commit/a8e1d0d4c660e2a61e4621766a009bfe4f567ddb))
* **desktop:** the installed app brings the whole project: the CLI, the skills and the tools ([11d4966](https://github.com/tomek-i/dj-claude/commit/11d4966af8765ae20a8d5e51497eac926663e522))
* **desktop:** the installed app's folder gets a CLAUDE.md of its own ([48e31f7](https://github.com/tomek-i/dj-claude/commit/48e31f789e49e7f6c3a89aded44fbf3d508eb9a8))
* **settings:** the project folder on the settings page, with "Open folder" and "Open Claude Code here" ([bffca05](https://github.com/tomek-i/dj-claude/commit/bffca058805c3ef9ce276350d655b87dad833580))
* **stems:** `dj stems setup` installs the stem separator in one command ([fa85eac](https://github.com/tomek-i/dj-claude/commit/fa85eac56b0bb8552f8a46e4e7ef58f20cfba155))
* **visuals:** the terrain morphs with the tunnel and the particle field ([a8eda31](https://github.com/tomek-i/dj-claude/commit/a8eda3132b2379df0ef791231a337abea9e8ddb9))


### Bug fixes

* **desktop:** never show the start dialog in the desktop app ([ff31a1a](https://github.com/tomek-i/dj-claude/commit/ff31a1a7cf9393679d1050e6ffefac73bbbbc7ab))
* **engine:** a page no longer takes the sound system from another without asking ([87ddccc](https://github.com/tomek-i/dj-claude/commit/87ddccccb4291dd2a40107311b21e860683cbd40))
* **stems:** only say separation is throttled when there is something to separate ([151c4b1](https://github.com/tomek-i/dj-claude/commit/151c4b18764c9e29d222a7a4eeddfcd36f58a333)), closes [#16](https://github.com/tomek-i/dj-claude/issues/16)
* **ui:** "Back to the decks" closes the health or settings tab, and no longer opens a second DJ page ([52e6b0c](https://github.com/tomek-i/dj-claude/commit/52e6b0c5fa58db6a36c1d737fca6f45777592b1c))
* **ui:** a tooltip on every control of the main page ([455c804](https://github.com/tomek-i/dj-claude/commit/455c8049567ed04c0d5d759a3de0548a1f860a50))
* **ui:** close the 1 px gap under the tab bar in Browse ([8834f9a](https://github.com/tomek-i/dj-claude/commit/8834f9af120a6cdc14150dc4fee1ed7114f39ad3)), closes [#15](https://github.com/tomek-i/dj-claude/issues/15)
* **ui:** leaving Browse no longer stretches the decks and hides the bottom panel ([6021378](https://github.com/tomek-i/dj-claude/commit/60213781ee14e8f220c621fdd741bb0cfd420ad7)), closes [#14](https://github.com/tomek-i/dj-claude/issues/14)
* **visuals:** free the old buffers when the quality tier steps down ([b18cdf5](https://github.com/tomek-i/dj-claude/commit/b18cdf5f34b96a877b5a2a713175a3e24ca34449))

## [0.2.0](https://github.com/tomek-i/dj-claude/compare/v0.1.0...v0.2.0) (2026-10-07)


### Features

* **desktop:** an Electron app on the same server and page ([5aa1e45](https://github.com/tomek-i/dj-claude/commit/5aa1e4559e7b70f55e0f408babb4707c37cef4fc)), closes [#5](https://github.com/tomek-i/dj-claude/issues/5)
* **stems:** separate on the GPU when there is one, fall back to the CPU ([492bd72](https://github.com/tomek-i/dj-claude/commit/492bd72041db075a5b39c03dbb5c24eebea9d205)), closes [#4](https://github.com/tomek-i/dj-claude/issues/4)
* **visuals:** a live visualiser page at /visuals for a second screen ([da16705](https://github.com/tomek-i/dj-claude/commit/da167058caf5798e3bd7b2615940ad37b1e4b1b6)), closes [#1](https://github.com/tomek-i/dj-claude/issues/1)
* **visuals:** low-latency audio over WebRTC, with the relay as fallback ([6854c0c](https://github.com/tomek-i/dj-claude/commit/6854c0c3f0c8be9e9061ab51ec5df6fe03408e37)), closes [#3](https://github.com/tomek-i/dj-claude/issues/3)
* **visuals:** morph between modes instead of a crossfade ([aed72bd](https://github.com/tomek-i/dj-claude/commit/aed72bd9db0b6ff0b8ce6504a773b90d49b945e1)), closes [#2](https://github.com/tomek-i/dj-claude/issues/2)


### Bug fixes

* **stems:** drop the shorter-segment retry before the CPU fallback ([1d25fb8](https://github.com/tomek-i/dj-claude/commit/1d25fb817418667746b48eb4581dc3bc1e54941a))
* **ui:** keep the header on screen when the bottom panel is maximised ([5d48408](https://github.com/tomek-i/dj-claude/commit/5d484083066906c10f897df2c145dd74981ef7f3))


### Restructuring

* move the code into apps/ and tools/ ([8660282](https://github.com/tomek-i/dj-claude/commit/8660282a90eb842e4f2bc96b1f892fe6c9906177)), closes [#5](https://github.com/tomek-i/dj-claude/issues/5)
* one module that knows where the project's folders are ([c340b05](https://github.com/tomek-i/dj-claude/commit/c340b057b7ac64f4d109f372bf16c55ed0db11c2)), closes [#5](https://github.com/tomek-i/dj-claude/issues/5)
