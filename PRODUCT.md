# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who search their local documents and code, and interviewers who inspect the hand-built engine.

## Product Purpose

Find useful passages in uploaded documents and repository files. Show how indexing, ranking, storage, and recovery work with reproducible evidence.

## Capabilities and Constraints

TypeScript engine, Fastify API, Next.js workspace, and a separate engineering guide. Keep storage and lexical search hand-built. Run one writer per data directory. The expanded research implementation adds optional OCR and inference adapters; generated answers remain outside this scope. No commits or contributor attribution.

## Product Principles

- Measure search quality alongside speed and memory.
- Preserve documents when ingestion or recovery fails.
- Make search accessible without requiring query syntax.
- Expose engineering detail on demand.
- Give searching, source management, saved work, and maintenance distinct workflows.

## Evidence on Hand

Existing unit and API tests, a bundled Wikipedia corpus, benchmark scripts, and a SIGKILL crash harness. New performance claims require fresh measurements.
