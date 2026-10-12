import Link from "next/link";

const PATHS: Record<string, string> = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  chevron: "M6 9l6 6 6-6",
  upload: "M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  download: "M12 4v11M7 10l5 5 5-5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2ZM4 19V5M8 7h7",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  menu: "M4 7h16M4 12h16M4 17h10",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  bookmark: "M6 4h12v16l-6-4-6 4Z",
  layers: "M12 3l9 5-9 5-9-5ZM3 13l9 5 9-5",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4",
  pause: "M8 5v14M16 5v14",
  play: "M7 5l12 7-12 7Z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  file: "M6 3h8l4 4v14H6ZM14 3v4h4",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  github: "M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.4 6-6.6a5 5 0 0 0-1.4-3.6 4.7 4.7 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.4 0C6.1 1.1 5 1.4 5 1.4a4.7 4.7 0 0 0-.1 3.5A5 5 0 0 0 3.5 8.5c0 5.2 3 6.3 6 6.6a3 3 0 0 0-.9 2.3V21",
  pulse: "M3 12h4l3-7 4 14 3-7h4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="Shardly home">
      Shardly<span className="brand-mark">.</span>
    </Link>
  );
}

export function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="switch">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (next: T) => void }) {
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      <div>
        {options.map(([v, text]) => (
          <label key={v}>
            <input type="radio" name={label} checked={value === v} onChange={() => onChange(v)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Progress({ value, max, label }: { value?: number; max?: number; label: string }) {
  const pct = value !== undefined && max ? Math.min(100, (value / max) * 100) : undefined;
  return (
    <div className={`progress${pct === undefined ? " indeterminate" : ""}`} role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemax={max}>
      <span style={pct === undefined ? undefined : { transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div key={message} className="toast" role="status"><Icon name="check" size={14} />{message}</div>;
}
