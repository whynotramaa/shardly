import type { ReactNode } from "react";

/**
 * Fades a block in as it scrolls into view, using a native CSS view timeline.
 * No JavaScript, so the content is visible whatever the browser does with the
 * animation. See `.reveal` in globals.css.
 */
export default function Reveal({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`reveal ${className}`}>{children}</div>;
}
