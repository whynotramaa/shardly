# Shardly engineering guide

This is the separate Next.js engineering website. The document workspace lives in `../web/` and the API lives in `../src/`.

From this directory, install dependencies and start the guide on port 3002.

```sh
npm install
npm run dev
```

For a production build, stop the development server before building. Both commands use the same `.next` directory.

```sh
npm run build
npm start
```

The workspace links default to `http://localhost:3000/app`. Set `NEXT_PUBLIC_APP_URL` to the deployed workspace URL before building when hosting the guide elsewhere.

```sh
NEXT_PUBLIC_APP_URL=https://your-workspace.example/app npm run build
```

`ENGINEERING_FACTS.md` records the implementation sources and qualifications behind the copy. Recorded evaluation values come from `../benchmarks/retrieval-2026-10-19.json`; illustrative diagrams do not represent measured execution times.

The chapter order and rail summaries live in `lib/chapters.ts`. `components/engineering-scene.tsx` owns the four controlled SVG sequences. The English tokenizer and baseline BM25 labs use `lib/shardly.ts`; `../tests/website-analyzer.test.ts` checks analyzer parity and the illustrated examples.

Coconat Regular is served from `public/fonts/` with its SIL Open Font License. Syne and Geist Mono retain the existing Google Fonts loading path. `DESIGN.md` and `.impeccable/design.json` describe this website, independently of the workspace design system.
