# Changelog

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
