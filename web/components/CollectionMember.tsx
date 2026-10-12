"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getDocument } from "@/lib/api";
import { describe } from "@/lib/docmeta";
import { Icon } from "@/components/ui";

export default function CollectionMember({ id, collection, onRemove }: { id: string; collection: string; onRemove: () => void }) {
  const element = useRef<HTMLLIElement>(null);
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let started = false;
    const observer = new IntersectionObserver((entries) => {
      if (started || !entries.some((entry) => entry.isIntersecting)) return;
      started = true; observer.disconnect();
      getDocument(id).then((record) => { if (active) setTitle(describe(record.doc).title); }).catch(() => { if (active) setTitle("Document unavailable"); });
    });
    if (element.current) observer.observe(element.current);
    return () => { active = false; observer.disconnect(); };
  }, [id]);
  return (
    <li ref={element}>
      <Link href={`/document/${encodeURIComponent(id)}`} className="list-link"><Icon name="file" size={15} /><span>{title ?? <span className="shimmer-text">Loading</span>}<small className="mono">{id}</small></span></Link>
      <button type="button" className="icon-button ghost" onClick={onRemove} aria-label={`Remove ${title ?? id} from ${collection}`}><Icon name="x" size={14} /></button>
    </li>
  );
}
