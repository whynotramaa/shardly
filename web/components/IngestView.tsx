"use client";

import { useRef, useState } from "react";
import { uploadFiles, resetStore, type UploadResult } from "@/lib/api";
import WikipediaLoader from "@/components/WikipediaLoader";

export default function IngestView({ onIngested }: { onIngested: () => void }) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await uploadFiles(Array.from(fileList)));
      onIngested();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function clearAll() {
    if (!confirm("Delete ALL documents and start empty? This cannot be undone."))
      return;
    setBusy(true);
    setErr(null);
    try {
      await resetStore();
      setResult(null);
      onIngested();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  const skipped = result?.results.filter((r) => r.status === "skipped") ?? [];

  return (
    <>
    <div className="panel">
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="dz-icon">{busy ? "ÃƒÂ¢Ã‚ÂÃ‚Â³" : "ÃƒÂ¢Ã‚Â¬Ã¢â‚¬Â "}</div>
        <div className="dz-title">
          {busy ? "Extracting & indexingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" : "Drop files here, or click to choose"}
        </div>
        <div className="dz-sub">
          <code>.pdf</code> is extracted to text, then indexed.{" "}
          <code>.txt .md .csv</code> and source code become one document each.{" "}
          <code>.json</code> / <code>.ndjson</code> stay structured. Images and
          other binaries are skipped automatically.
        </div>
      </div>

      {result && (
        <>
          <div className="notice ok">
            Indexed <b>{result.indexed}</b> document
            {result.indexed === 1 ? "" : "s"} from{" "}
            <b>{result.results.length}</b> file
            {result.results.length === 1 ? "" : "s"}. Head to the{" "}
            <b>Search</b> tab.
          </div>
          {skipped.length > 0 && (
            <div className="file-report">
              {skipped.map((r) => (
                <div key={r.filename} className="file-line skipped">
                  <span className="badge skip">skipped</span>
                  <span className="fname">{r.filename}</span>
                  <span className="reason">{r.reason}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {err && <div className="notice err">{err}</div>}

      <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
        <span className="hint">
          Every string and number field is tokenized and added to the inverted
          index the moment it&apos;s written.
        </span>
        <button
          className="danger"
          onClick={clearAll}
          disabled={busy}
          title="Remove all indexed documents"
        >
          Clear all documents
        </button>
      </div>
    </div>

    <WikipediaLoader onIngested={onIngested} />
    </>
  );
}





