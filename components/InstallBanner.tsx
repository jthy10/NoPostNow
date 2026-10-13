"use client";

import { useEffect, useState } from "react";
import { isPhone, isStandalone } from "@/lib/push";
import { site } from "@/lib/site";

// Chrome's install event — not in the TS DOM lib yet.
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

const shareIcon = (
  <svg
    viewBox="0 0 24 24"
    className="inline h-[15px] w-[15px] align-[-2px]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
);

// Persistent nudge for phone browsers: the app experience only exists once
// the app is on the Home Screen, so this stays until they're in the PWA —
// no dismiss by design. Hidden in standalone mode and on desktop.
export default function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || !isPhone()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time environment sniff on mount
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setVisible(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible) return null;

  const steps = isIOS
    ? [
        <>Tap the Share button {shareIcon} at the bottom of Safari</>,
        <>Scroll down the menu</>,
        <>
          Tap <span className="font-bold text-white">&ldquo;Add to Home Screen&rdquo;</span>
        </>,
        <>Open {site().siteName} from your Home Screen</>,
      ]
    : null;

  return (
    <div className="mx-2.5 mt-2.5 rounded-lg border-[0.5px] border-edge bg-card p-4">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-[10px]" />
        <div className="min-w-0">
          <p className="text-sm font-extrabold">Try Our New App!</p>
          <p className="mt-0.5 text-[11px] leading-snug text-meta">
            Full-screen feed, app icon, and notifications when friends post.
          </p>
        </div>
      </div>

      {isIOS ? (
        <ol className="mt-3 flex flex-col gap-1.5">
          {steps!.map((step, i) => (
            <li key={i} className="flex items-baseline gap-2.5 text-xs leading-relaxed text-body">
              <span className="w-3 shrink-0 text-right font-bold text-mut">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : installEvt ? (
        <button
          onClick={() => installEvt.prompt()}
          className="mt-3 w-full rounded-lg bg-white py-2.5 text-xs font-extrabold tracking-[0.3px] text-black transition-opacity active:opacity-75"
        >
          Install
        </button>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-body">
          Open your browser menu and tap{" "}
          <span className="font-bold text-white">&ldquo;Add to Home screen&rdquo;</span>.
        </p>
      )}
    </div>
  );
}
