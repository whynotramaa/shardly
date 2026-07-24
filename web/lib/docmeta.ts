

export type Doc = Record<string, unknown>;

export interface DocMeta {
  title: string;
  badge: string;
}

const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cc", "cs", "php", "swift", "scala", "sh", "bash",
  "zsh", "sql", "graphql", "css", "scss", "html", "xml", "yaml", "yml", "toml",
  "vue", "svelte", "ini", "conf", "dockerfile",
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

export function extensionOf(filename: string): string {
  const base = filename.toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(dot + 1);
}

export function describe(doc: Doc): DocMeta {
  if (doc.source === "wikipedia") {
    return { title: String(doc.title ?? "Article"), badge: "wiki" };
  }
  if (doc.source === "github") {
    if (doc.type === "file") {
      return { title: `${doc.repo}/${doc.path}`, badge: "github file" };
    }
    return { title: String(doc.fullName ?? doc.repo ?? "repo"), badge: "github repo" };
  }
  if (doc.type === "pdf") {
    return { title: String(doc.filename ?? "document.pdf"), badge: "pdf" };
  }
  if (typeof doc.filename === "string") {
    return { title: doc.filename, badge: "file" };
  }
  return { title: String(doc.title ?? doc.name ?? "Document"), badge: "json" };
}

/** The main body text of a document, whatever field it lives in. */
export function primaryText(doc: Doc): string {
  for (const key of ["content", "readme", "body", "text", "description"]) {
    const v = doc[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

/** A one-line snippet for lists and search results. */
export function snippet(doc: Doc, max = 220): string {
  const raw = primaryText(doc) || JSON.stringify(doc);
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max).trimEnd() + "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : s;
}

export type RenderMode = "repo" | "code" | "markdown" | "pdf" | "json" | "text";

export function renderMode(doc: Doc): { mode: RenderMode; language?: string } {
  if (doc.source === "wikipedia") return { mode: "text" };
  if (doc.source === "github" && doc.type !== "file") return { mode: "repo" };

  const path = String(doc.path ?? doc.filename ?? "");
  const ext = path ? extensionOf(path) : "";

  if (doc.type === "pdf") return { mode: "pdf" };
  if (doc.source === "github" && doc.type === "file") {
    return { mode: "code", language: ext };
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) return { mode: "markdown" };
  if (ext === "json") return { mode: "json" };
  if (CODE_EXTENSIONS.has(ext)) return { mode: "code", language: ext };

  // No filename hint: structured object ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ JSON; a text blob ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ text.
  if (typeof doc.content === "string") return { mode: "text" };
  return { mode: "json" };
}







