# Shardly film

A 128 second explainer (1920x1080, 30fps, stereo AAC at -14 LUFS) for someone seeing Shardly for the first time. It opens in light mode as the product, wipes into dark mode to go inside the engine, and returns to daylight once the crash is survived.

Type: Zarathustra for display (Coconat covers the glyphs Zarathustra lacks, such as `&`, `+` and `·`), Syne for interface text, Geist Mono for code and data. One rust accent, hairlines, and the product's `cubic-bezier(0.16, 1, 0.3, 1)` curve.

Output: `out/shardly.mp4`

| Time | Scene | What it shows |
| --- | --- | --- |
| 0 to 10 | open | "Somewhere in your files is the answer you need." A field of real files and articles drifts past; 2,447 documents; "Shardly finds it." The field is pulled into a point that opens into the search box |
| 10 to 23 | search | `crash recovery` is typed into the real UI; results with highlighted passages, timing, and the split preview, with two callouts. "How did it find that in 6.5 milliseconds?" The UI collapses into the Search button |
| 23 to 31 | inside | Night opens from that point. "Inside, every layer is hand-built." The six-layer map: ingest, analyze, index, rank, store, recover. It folds into the chapter rail |
| 31 to 42 | 01 ingest | Folder, GitHub, PDF, NDJSON and Wikipedia sources flow through the extractor into a JSON document; a binary file bounces off |
| 42 to 54 | 02 analyze | The real sentence is split, lowercased, stripped of its stopword and stemmed; `replayWalRecord` splits on camelCase |
| 54 to 69 | 03 index | Three toy documents build an inverted index token by token; then the real corpus as 2,447 dots: a full scan against two posting lists and 32 candidates |
| 69 to 85 | 04 rank | The BM25 formula and its three ideas: IDF (`http` 0.02 against `crash` 4.69), term-frequency saturation, length normalization; the real per-term breakdown and the ranking |
| 85 to 97 | 05 store | An append-only segment fills; the offset map seeks to byte 122,996, reads 3,304 bytes, verifies SHA-256; a tombstone |
| 97 to 113 | 06 recover | The four-step write path with a real WAL record; `kill -9` mid-write; blackout; replay keeps the committed write and discards the torn one; 225,141 acknowledged writes, 8 kills, 0 lost |
| 112 to 128 | finale | Daylight blooms from the 0; the six layers; wordmark, "A search engine you can read.", repo link |

Every number is real. `scripts/capture-search.ts` indexes this repository's code and docs plus the bundled 2,386-article Wikipedia sample with the actual Engine and records results, timings, tokens, posting lists, IDF values, document lengths, offset-map entries with checksums, and a real WAL pending/committed pair in `search-data.json`. The durability figures come from `VERIFICATION.md`. The PDF card names and `photo.png` are illustrative; they stand for file types the product ingests or rejects. The three documents in the index scene are a labeled toy example.

## Rebuild

```bash
npm ci                                     # repo root
npx tsx video/scripts/capture-search.ts    # real search data
python3 video/scripts/sound.py             # numpy score, writes out/sound.wav
node video/scripts/render.mjs --out video/out/silent.mp4   # 4 parallel workers, near-lossless master
ffmpeg -i video/out/silent.mp4 -i video/out/sound.wav -c:v libx264 -preset slow -crf 20 -tune grain -pix_fmt yuv420p -af "loudnorm=I=-14:TP=-1:LRA=11" -ar 48000 -c:a aac -b:a 256k -shortest -movflags +faststart video/out/shardly.mp4
```

`timeline.json` holds every scene start. The composition and the score both read it, so moving a cue moves picture and sound together.

`node video/scripts/render.mjs --stills 3.6,10.5` writes single frames to `video/stills/` for review. Needs Playwright's Chromium and ffmpeg. Every frame is a pure function of time (`seek(t)` in `composition.html`), so renders are deterministic.

The mix is high-passed at 55 Hz with most energy between 120 Hz and 2 kHz so it carries on phone and laptop speakers.

Fonts: Zarathustra (Lorene Ceccon), Coconat (Collletttivo), Syne and Geist Mono, all under the SIL Open Font License.
