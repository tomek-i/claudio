# What the auto-DJ does

This file gives the auto-DJ's exact behaviour: when it triggers, which track it cues, when the mix starts and which mix it picks.

- When it triggers: the live track has 45 s of audible music left, no transition is running and no mix is planned. The 45 s is the lead time.
- What it cues: 25 s before that, at 70 s left, it makes sure a next track is on the idle deck, in this order:
  1. A track you already loaded on the idle deck, unless it was played recently. While a set is active, only a track of that set that has not played counts.
  2. The first track in `dj queue`.
  3. With a set active (`dj sets use "<name>"`), a track of the set that has not played: the next in the list when the set's `pick` is `order`, or the one that fits the live deck best when it is `fit`.
  4. The best `dj suggest` result from the whole library that has not been played. When every track of the active set has played, this happens only if the set's `then` is `library`; with `then stop` nothing more is cued.
- When the mix starts: on the next phrase if there is time for the mix plus 8 more bars, otherwise on the next bar.
- Which mix it picks:

  | Tempo gap | Keys | Mix |
  |---|---|---|
  | 6 % or less | compatible | `bassswap`, 8 bars, `--in drop` |
  | 6 % or less | clash | `filter`, 8 bars, `--in mixin` |
  | above 6 % | any | `echo`, 1 bar, `--in drop` |

  Compatible means the same key, a neighbour or an energy-boost key at the pitch the track will play. If the track has no detected drop, `--in drop` becomes `--in mixin`.
