"use client";

import { useEffect } from "react";

// The net under every page. Without it, one render-time throw anywhere — a
// malformed doc, a bad id in a URL — unmounts the whole tree and leaves a
// blank black screen with no way out but force-quitting the PWA. The root
// layout (auth, service worker) stays mounted around this.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[2px] text-meta">
        Something went wrong
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => retry()}
          className="rounded-lg border-[0.5px] border-edge px-5 py-2 text-[11px] font-bold uppercase tracking-[1.5px] text-mut transition-colors hover:border-mut hover:text-white"
        >
          Try again
        </button>
        {/* A full load, not the router: if router state is what broke,
            a fresh document is the reset that actually works. */}
        <button
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the full load is the point
          onClick={() => window.location.assign("/")}
          className="rounded-lg border-[0.5px] border-edge px-5 py-2 text-[11px] font-bold uppercase tracking-[1.5px] text-mut transition-colors hover:border-mut hover:text-white"
        >
          Feed
        </button>
      </div>
    </div>
  );
}
