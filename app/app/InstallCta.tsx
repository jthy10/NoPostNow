"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isStandalone } from "@/lib/push";
import { site } from "@/lib/site";

// Chrome's install event — not in the TS DOM lib yet.
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

type Platform = "ios" | "android" | "desktop";

// In-app browsers (Instagram, Messenger, …) and non-Safari iOS browsers can't
// Add to Home Screen — the visitor has to hop to Safari first.
function isIosNonSafari(ua: string) {
  return /CriOS|FxiOS|EdgiOS|GSA|FBAN|FBAV|Instagram|Snapchat|Line\//i.test(ua);
}

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

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 text-sm leading-relaxed text-body">
      <span className="flex h-5 w-5 shrink-0 translate-y-0.5 items-center justify-center rounded-full bg-field text-[11px] font-bold text-white">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

// The GET button on /app. Opens a sheet walking through Add to Home Screen,
// tailored to the visitor's platform. Inside the installed PWA it flips to
// OPEN and just goes to the feed.
export default function InstallCta({ variant }: { variant: "pill" | "full" }) {
  const [open, setOpen] = useState(false);
  // Where this site lives, for the "open it on your phone" instructions.
  const [address, setAddress] = useState("this site");
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [needsSafari, setNeedsSafari] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time environment sniff on mount */
    if (isStandalone()) setInstalled(true);
    setAddress(window.location.host);
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      setPlatform("ios");
      if (isIosNonSafari(navigator.userAgent)) setNeedsSafari(true);
    } else if (/Android/.test(navigator.userAgent)) setPlatform("android");
    /* eslint-enable react-hooks/set-state-in-effect */
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // Keep the page from scrolling behind the sheet, and let Escape close it.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const buttonClass =
    variant === "pill"
      ? "rounded-full bg-white px-7 py-2 text-sm font-extrabold tracking-[0.5px] text-black transition-opacity active:opacity-75"
      : "w-full rounded-xl bg-white py-3.5 text-sm font-extrabold tracking-[0.5px] text-black transition-opacity active:opacity-75";

  if (installed) {
    return (
      <Link href="/" className={`${buttonClass} block text-center`}>
        OPEN
      </Link>
    );
  }

  // Android with the native install prompt captured: skip the sheet entirely,
  // one tap installs.
  const handleClick =
    platform === "android" && installEvt ? () => installEvt.prompt() : () => setOpen(true);

  return (
    <>
      <button onClick={handleClick} className={buttonClass}>
        {variant === "pill" ? "GET" : `Install ${site().siteName}`}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 animate-[fade-in_0.15s_ease] sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Install ${site().siteName}`}
            className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl border-[0.5px] border-edge bg-card p-6 animate-[sheet-up_0.25s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold">Install {site().siteName}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-meta">
                  No app store, no download — it installs straight from the browser.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-field text-mut transition-opacity active:opacity-75"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>

            <div className="mt-5 border-t-[0.5px] border-line pt-5">
              {platform === "ios" && needsSafari ? (
                <p className="text-sm leading-relaxed text-body">
                  This browser can&rsquo;t install apps — that&rsquo;s an iPhone rule, not ours.
                  Open <span className="font-bold text-white">{address}/app</span> in{" "}
                  <span className="font-bold text-white">Safari</span> and tap GET there.
                </p>
              ) : platform === "ios" ? (
                <ol className="flex flex-col gap-3">
                  <Step n={1}>Open this page in <span className="font-bold text-white">Safari</span> (if you&rsquo;re not already)</Step>
                  <Step n={2}>Tap the Share button {shareIcon} at the bottom</Step>
                  <Step n={3}>Scroll down and tap <span className="font-bold text-white">&ldquo;Add to Home Screen&rdquo;</span></Step>
                  <Step n={4}>Open <span className="font-bold text-white">{site().siteName}</span> from your Home Screen</Step>
                </ol>
              ) : platform === "android" && installEvt ? (
                <button
                  onClick={() => installEvt.prompt()}
                  className="w-full rounded-xl bg-white py-3 text-sm font-extrabold tracking-[0.3px] text-black transition-opacity active:opacity-75"
                >
                  Install now
                </button>
              ) : platform === "android" ? (
                <ol className="flex flex-col gap-3">
                  <Step n={1}>Tap the <span className="font-bold text-white">⋮</span> menu in the top corner of your browser</Step>
                  <Step n={2}>Tap <span className="font-bold text-white">&ldquo;Add to Home screen&rdquo;</span></Step>
                  <Step n={3}>Open <span className="font-bold text-white">{site().siteName}</span> from your Home Screen</Step>
                </ol>
              ) : (
                <p className="text-sm leading-relaxed text-body">
                  The app lives on phones. Open{" "}
                  <span className="font-bold text-white">{address}/app</span> on your phone and
                  tap GET.
                </p>
              )}
            </div>

            {platform !== "desktop" && (
              <p className="mt-5 text-[11px] leading-snug text-mut">
                Once it&rsquo;s on your Home Screen you get the full-screen feed and push
                notifications — the browser version can&rsquo;t do that.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
