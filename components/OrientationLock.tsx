"use client";

import { useEffect, useState } from "react";
import { isPhone, isStandalone } from "@/lib/push";
import { site } from "@/lib/site";

// iOS ignores the manifest's orientation lock, so inside the installed PWA a
// landscape turn gets a full-screen "rotate back" overlay instead. Android is
// truly locked by the manifest and never sees this.
export default function OrientationLock() {
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    if (!isStandalone() || !isPhone()) return;
    const mq = window.matchMedia("(orientation: landscape)");
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!landscape) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-canvas">
      <svg
        viewBox="0 0 24 24"
        className="h-10 w-10 animate-[wiggle_1.2s_ease-in-out_infinite] text-mut"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <line x1="11" y1="18" x2="13" y2="18" />
      </svg>
      <p className="text-[11px] font-bold uppercase tracking-[2px] text-mut">
        Rotate your phone
      </p>
      <p className="-mt-2 text-[11px] text-dim">{site().siteName} is portrait only</p>
    </div>
  );
}
