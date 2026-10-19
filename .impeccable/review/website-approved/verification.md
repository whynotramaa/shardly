# Verification for the approved website build

- `npm run build` in website/ passed on 19 October 2026. Next.js emits a static root route, 10.5 kB route bundle and 113 kB first-load JS.
- `npx tsc --noEmit -p website/tsconfig.json` passed.
- `npx vitest run tests/website-analyzer.test.ts` passed both tests, including engine/lab token parity and the illustrated evidence span.
- All implementation file links checked against local paths. Public GitHub links still refer to main and may precede publication of this working tree.
- Native T3 browser tested 1440×1100 and 390×844 CSS viewports, light and dark themes. Neither had document-level horizontal overflow. Locally served Coconat loaded and was used by the headline.
- Rail hover previews opened; keyboard Tab opened a focus preview; Escape hid it; Enter navigated and active chapter tracking settled to the destination. Tooltips have a pointer bridge so their content can be hovered.
- Evidence SVG span measured x96, width27, matching its highlight and bracket.
- Evidence playback created a causal trace and SVG motion marker. Pause removed the motion marker and preserved the current step.
- Index playback paused at step0 while offscreen; after returning, it completed at step3 and stopped. Hybrid playback completed one pass and stopped.
- `hybrid-playback.mp4` is a native browser recording. `motion-frames.png` is an ffmpeg contact sheet at one frame per second, showing the actual sequence rather than generated imagery.
- Main light-theme text contrast: reading 9.69:1, source links6.74:1, control/description15.52:1.
- Native captures are viewport/section captures, not full-page screenshots. Required evidence: desktop.png, desktop-preview.png, desktop-dark.png, desktop-evidence.png, mobile.png, mobile-evidence.png, mobile-measurements.png, motion-frames.png. Their names were visually checked; the evidence scene was recaptured after a departing tooltip faded.
- Detector ran once for this approved build. Only inherited Geist Mono triggers its generic font warning. Coconat/Syne remain the display/reading voices; no further detector runs.

Limits: no full screen-reader or physical touch-device audit; reduced-motion branches checked in implementation rather than OS emulation; this UI change does not remeasure model quality or durability.

## Review fix batch and user centering correction

The fresh reviewer requested a shared TableScroll wrapper for the tokenizer lab and readable storage diagram labels. Both are implemented. The storage lab now exposes segment/offset/length as HTML readouts and its 640-unit SVG has 16-unit labels with a560px minimum rendered width, measured at14 CSS px on mobile. Both lab scroll regions have labels, tab stops, and mobile pan hints. The user also requested centered text containers. At1440px, hero copy, article, and reading paragraph measure left375px, width690px, midpoint720px. The mobile layout has no document overflow. BM25 lab controls now occupy a full row so centering does not compress the charts. Production build, TypeScript, and both analyzer tests passed after the fixes. All original viewports were recaptured; mobile-seek.png and mobile-tokenizer.png were added. No second detector ran.

Final contrast correction: the active evidence tspan uses --on-accent. Its highlight switches without an interpolated color transition. Browser computed RGB pairs measure 9.09:1 on peach and 10.09:1 on blue. Both active states were recaptured as mobile-evidence.png and mobile-evidence-light.png. Production build passed after this correction.
