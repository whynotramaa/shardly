# Completion checklist

A checkbox means implemented and verified. This file records the agreed scope; it does not claim that Shardly outperforms every search engine.

- [x] Storage recovery, rotation, corruption detection, single-writer lock, and fault tests.
- [x] Field-aware ranking, Unicode and identifier analysis, exact phrases, all/any words, exclusions, and filters.
- [x] Passage-level search with original-text offsets, snippets, and parent grouping.
- [x] Bounded prefix and typo matching, suggestions, and scoped optional synonyms.
- [x] Live facet counts and expandable repository/source groups.
- [x] Search-first accessible workspace, keyboard navigation, split preview, pagination, and query URLs.
- [x] Saved searches and named collections with explicit document membership.
- [x] Stable ingestion identities, deduplication, updates, jobs, progress, retry, and cancellation.
- [x] Baseline/tuned ranking comparison and live query inspector.
- [x] Engine diagnostics and vocabulary/posting inspection.
- [x] Portable validated backup export and safe restore.
- [x] Relevance evaluation, reproducible performance measurements, and crash testing.
- [x] Builds, API integration tests, and desktop/mobile browser checks.
- [x] Documentation reflects shipped behavior and measured limits.

Evidence: [verification report](VERIFICATION.md).

Optional OCR is available through installed external tools. AI chat, distributed infrastructure, billing, and team accounts remain outside this scope. See [research implementation status](IMPLEMENTATION.md) for the expanded retrieval work.

## Next completion checklist

- [x] Packed postings, bounded document cache, and reduced full-index checkpoint costs, measured against the prior version.
- [x] Worker-backed production API and measured search responsiveness during imports.
- [x] Managed local folder sources with ignores, edits, renames, deletion, pause/resume, and rescan.
- [x] Literal/symbol and substring search with accurate source highlights.
- [x] Missing-match explanations for matching, filters, expansions, and result pagination.
- [x] External human-judged relevance evaluation and real concurrent HTTP load measurement.
- [x] Cancellable shadow index rebuild with version-guarded atomic publication.
- [x] Guided interview demonstration with actual engine state and safe actions.
- [x] Search-focused frontend with separate source, library, and maintenance workflows.
