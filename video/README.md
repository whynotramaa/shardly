# Shardly film

A 20 second motion piece (1920x1080, 30fps, stereo AAC) built in the product's own design language: Instrument Serif / Syne / Geist Mono, one rust accent, hairlines, the `cubic-bezier(0.16, 1, 0.3, 1)` curve.

Output: `out/shardly-20s.mp4`

| Time | Beat |
| --- | --- |
| 0.0 to 2.0 | `kill -9` typed into a bare terminal, then 4 frames of silence |
| 2.0 to 4.0 | "Mid-write. 3,000 documents in. What survived?" with a rust fuse drawing under it |
| 4.0 to 7.0 | the fuse lifts into the WAL lane; pending, segment, committed, each with an fsync tick |
| 7.0 to 8.5 | SIGKILL tears the second write; a recovery scan keeps the committed record and discards the torn one |
| 8.5 to 10.0 | 225,141 acknowledged writes, 8 kills, 0 lost (from VERIFICATION.md) |
| 10.0 to 13.2 | the underline under the 0 becomes the search box; `replayWalRecord` cracks into its real tokens |
| 13.2 to 16.0 | real top 3 hits, then the winner's score breakdown stacks into its total |
| 16.0 to 20.0 | the total bar collapses into a hairline; Shardly wordmark; the opening cursor blinks once |

Search results, scores and tokens are real: `scripts/capture-search.ts` indexes this repository's `src/` and `tests/` with the actual Engine and writes `search-data.json`. The code excerpt under each hit is a real line from that file chosen for legibility; the engine's own snippet is used for ranking only.

## Rebuild

```bash
npm ci                                     # repo root
npx tsx video/scripts/capture-search.ts    # real search data
python3 video/scripts/sound.py             # numpy, writes out/sound.wav
node video/scripts/render.mjs --out video/out/silent.mp4
ffmpeg -i video/out/silent.mp4 -i video/out/sound.wav -c:v copy -c:a aac -b:a 256k -shortest video/out/shardly-20s.mp4
```

`node video/scripts/render.mjs --stills 3.6,9.9` writes single frames to `video/stills/` for review. Needs Playwright's Chromium and ffmpeg. Every frame is a pure function of time (`seek(t)` in `composition.html`), so renders are deterministic.

Fonts are the Google Fonts latin subsets, SIL Open Font License.
