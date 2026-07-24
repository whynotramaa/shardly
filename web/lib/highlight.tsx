import type { ReactNode } from "react";

/** Turn a raw query string into distinct lowercase words worth highlighting. */
export function queryTerms(q: string | null | undefined): string[] {
  if (!q) return [];
  const seen = new Set<string>();
  for (const w of q.toLowerCase().split(/[^a-z0-9]+/i)) {
    if (w.length >= 2) seen.add(w);
  }
  return [...seen].slice(0, 12);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function buildRegex(terms: string[]): RegExp {
  const alt = terms.map(escapeRegex).join("|");
  return new RegExp(`\\b(?:${alt})\\w*`, "gi");
}

/** Wrap query-term matches in <mark> inside plain React text. */
export function markText(text: string, terms: string[]): ReactNode {
  if (terms.length === 0 || !text) return text;
  const re = buildRegex(terms);
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (start > last) out.push(text.slice(last, start));
    out.push(<mark key={key++}>{m[0]}</mark>);
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}


export function highlightDom(root: HTMLElement, terms: string[]): number {
  if (terms.length === 0) return 0;
  const re = buildRegex(terms);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = (node as Text).parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === "MARK" || tag === "SCRIPT" || tag === "STYLE")
        return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim())
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode()) !== null) targets.push(n as Text);

  let count = 0;
  for (const textNode of targets) {
    const text = textNode.nodeValue ?? "";
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
      const mark = document.createElement("mark");
      mark.textContent = m[0];
      frag.appendChild(mark);
      count++;
      last = end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return count;
}







