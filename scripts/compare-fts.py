"""Offline SQLite FTS5 comparator. Receives pre-tokenized documents over stdin."""
import json
import sqlite3
import sys
import time

payload = json.load(sys.stdin)
db = sqlite3.connect(":memory:")
started = time.perf_counter()
db.execute("CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, terms, tokenize='ascii')")
db.executemany("INSERT INTO docs VALUES (?, ?)", [(d["id"], d["terms"]) for d in payload["documents"]])
db.commit()
ingest_ms = (time.perf_counter() - started) * 1000
results = []
for case in payload["queries"]:
    # OR matches Shardly's default any-word mode; parameters protect the SQL boundary.
    query = " OR ".join('"' + term.replace('"', '""') + '"' for term in case["terms"])
    times = []
    hits = []
    for run in range(payload["runs"] + 3):
        started = time.perf_counter()
        hits = db.execute("SELECT id FROM docs WHERE docs MATCH ? ORDER BY bm25(docs), id LIMIT 10", (query,)).fetchall()
        elapsed = (time.perf_counter() - started) * 1000
        if run >= 3:
            times.append(elapsed)
    times.sort()
    results.append({"query": case["query"], "p50Ms": times[len(times) // 2], "p95Ms": times[min(len(times) - 1, int(len(times) * .95))], "ids": [row[0] for row in hits]})
print(json.dumps({"sqliteVersion": sqlite3.sqlite_version, "ingestMs": ingest_ms, "results": results}))
db.close()
