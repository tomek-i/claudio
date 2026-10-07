# Changelog

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
