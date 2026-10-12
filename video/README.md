# Shardly film

A 30 second motion piece (1920x1080, 30fps, stereo AAC at -14 LUFS) in the product's design language: Instrument Serif / Syne / Geist Mono, one rust accent, hairlines, the `cubic-bezier(0.16, 1, 0.3, 1)` curve. Cuts land on a 120 BPM beat grid.

Output: `out/shardly.mp4`

| Time | Scene | What happens |
| --- | --- | --- |
| 0 to 4 | what | code, docs, PDFs, repos and wiki cards pop on sixteenths; "Your code. Your docs. Your PDFs, repos, wikis." They get pulled into a point that opens into one search box |
| 4 to 9 | search | "crash recovery" is typed; real results with highlighted passages, timing, and a split preview |
| 9 to 19 | inside | "Now open it up." The box tilts into an exploded technical drawing: query, analyzer, inverted index, ranker, storage. A signal descends one layer per three beats, then carries the answer back up |
| 19 to 25 | crash | the storage layer swings flat into the write path; `kill -9` tears a write; WAL replay keeps the committed record; 225,141 acknowledged writes, 8 kills, 0 lost |
| 25 to 30 | shardly | the line under the 0 becomes the lockup hairline; wordmark, "A search engine you can read.", repo link |

Every number is real. `scripts/capture-search.ts` indexes this repository's code and docs plus the bundled 2,386-article Wikipedia sample with the actual Engine, runs the query in all-terms mode, and records results, tokens, posting-list sizes, scores and the top hit's byte offset in `search-data.json`. The durability figures come from `VERIFICATION.md`. The `design-review.pdf` card is the only illustrative name; it stands for a file type the product ingests.

## Rebuild

```bash
npm ci                                     # repo root
npx tsx video/scripts/capture-search.ts    # real search data
python3 video/scripts/sound.py             # numpy score, writes out/sound.wav
node video/scripts/render.mjs --out video/out/silent.mp4
ffmpeg -i video/out/silent.mp4 -i video/out/sound.wav -c:v copy -af "loudnorm=I=-14:TP=-1:LRA=11" -c:a aac -b:a 256k -shortest video/out/shardly.mp4
```

`node video/scripts/render.mjs --stills 3.6,10.5` writes single frames to `video/stills/` for review. Needs Playwright's Chromium and ffmpeg. Every frame is a pure function of time (`seek(t)` in `composition.html`), so renders are deterministic.

The mix is high-passed at 90 Hz and kept mostly in the 120 Hz to 2 kHz range so it carries on phone and laptop speakers.

Fonts are the Google Fonts latin subsets, SIL Open Font License.
