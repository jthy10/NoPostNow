"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";

// A normal-flow, viewport-sized app frame. Locking the root document keeps
// iOS from carrying a stale window scroll offset across keyboard/navigation
// changes and moving the whole PWA frame away from the screen edges.
export default function ViewportShell({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

  return (
    <div
      className="pwa-viewport-shell flex min-h-0 flex-col overflow-hidden bg-canvas"
      style={style}
    >
      {children}
    </div>
  );
}
