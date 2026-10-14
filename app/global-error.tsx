"use client";

import { site } from "@/lib/site";

// Last resort, for a throw in the root layout itself (where app/error.tsx
// can't reach). It replaces the whole document, so no globals.css — inline
// styles keep it on the app's black rather than a white flash.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          background: "#0a0a0a",
          color: "#8a8a8a",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>{site().siteName}</title>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>
          Something went wrong
        </p>
        <button
          onClick={() => retry()}
          style={{
            background: "none",
            border: "0.5px solid #2a2a2a",
            borderRadius: 8,
            padding: "8px 20px",
            color: "#8a8a8a",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
