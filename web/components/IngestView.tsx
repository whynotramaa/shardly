"use client";

import { useRef, useState } from "react";
import { uploadFiles, type UploadResult } from "@/lib/api";
import { Icon, Progress, Segmented } from "@/components/ui";

export default function IngestView({ onIngested }: { onIngested: () => void }) {
  const [busy, setBusy] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [namespace, setNamespace] = useState("");
  const [language, setLanguage] = useState("en");

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(fileList.length);
    setErr(null);
    setResult(null);
    try {
      setResult(await uploadFiles(Array.from(fileList), { mode, namespace: namespace.trim() || undefined, contentLanguage: language }));
      onIngested();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const skipped = result?.results.filter((r) => r.status === "skipped") ?? [];
  const sum = (key: "added" | "updated" | "duplicates") => result?.results.reduce((n, item) => n + (item[key] ?? 0), 0) ?? 0;

  return (
    <section className="upload">
      <details className="block">
        <summary>Import options</summary>
        <Segmented label="Same-name files" value={mode} options={[["add", "Keep separate versions"], ["replace", "Replace in import group"]]} onChange={setMode} />
        <label className="label">Import group<input aria-label="Import group" value={namespace} maxLength={128} onChange={e => setNamespace(e.target.value)} placeholder="For example: research" /></label>
        <label className="label">Text language<select aria-label="Import text language" value={language} onChange={e => setLanguage(e.target.value)}>{[["en", "English"], ["hi", "Hindi"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"], ["tr", "Turkish"], ["fr", "French"], ["de", "German"], ["es", "Spanish"], ["ar", "Arabic"]].map(([code, title]) => <option key={code} value={code}>{title}</option>)}</select></label>
        <p className="hint">Repeated identical uploads are skipped. Replace updates files with the same name and import group. Common secret filenames are excluded.</p>
      </details>
      <div
        className={`dropzone${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="Choose files to upload"
        aria-disabled={!!busy}
        onKeyDown={(e) => { if (!busy && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) void handleFiles(e.dataTransfer.files); }}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        <span className="dz-icon"><Icon name="upload" size={22} /></span>
        <span className="dz-title">{busy ? `Indexing ${busy} ${busy === 1 ? "file" : "files"}…` : dragging ? "Release to add" : <>Drop files or <u>browse</u></>}</span>
        <span className="dz-sub">PDF, Word, slides, spreadsheets, text, code, JSON</span>
        {!!busy && <Progress label="Uploading" />}
      </div>
      {result && (
        <div className="upload-result" role="status">
          <p><Icon name="check" size={15} />{sum("added")} added, {sum("updated")} updated, {sum("duplicates")} unchanged</p>
          <details><summary>Extraction details</summary><ul className="skipped">{result.results.map((file, i) => <li key={`${file.filename}:${i}`}><span className="mono">{file.filename}</span><span>{file.status === "indexed" ? `${file.documents} records · ${file.parser ?? "text"}` : file.reason}</span></li>)}</ul></details>
          {skipped.length > 0 && (
            <ul className="skipped">
              {skipped.map((r) => <li key={r.filename}><span className="mono">{r.filename}</span><span>{r.reason}</span></li>)}
            </ul>
          )}
        </div>
      )}
      {err && <p className="alert" role="alert">{err}</p>}
    </section>
  );
}
