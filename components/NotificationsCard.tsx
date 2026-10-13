"use client";

import { useEffect, useState } from "react";
import {
  ensurePushSubscription,
  isStandalone,
  pushSupported,
  requestPushPermission,
} from "@/lib/push";
import { site } from "@/lib/site";

// Shown only inside the installed PWA, where push is actually possible.
// iOS requires the permission request to come from a tap, so this card is
// that tap. Not dismissible: it stays until notifications are on. Once
// granted, it silently re-syncs the subscription on every launch (new
// device, cleared data) and never appears again.
//
// On success the card celebrates before leaving: a green check pops in,
// then the banner folds up into it and fades out. On failure the edges
// flash red and the card stays put.
export default function NotificationsCard({ uid }: { uid: string }) {
  const [state, setState] = useState<"hidden" | "ask" | "blocked">("hidden");
  // idle → busy (OS prompt up) → check (green pop) → fold (collapse away),
  // or busy → error (red glow, back to idle so they can retry).
  const [phase, setPhase] = useState<"idle" | "busy" | "check" | "fold" | "error">("idle");
  // Failure stage from lib/push — shown in the card so problems on real
  // phones are diagnosable without a connected debugger.
  const [failReason, setFailReason] = useState<string | null>(null);

  useEffect(() => {
    if (!isStandalone() || !pushSupported()) return;
    if (Notification.permission === "granted") {
      // Permission is on but the subscription may still be missing (failed
      // save, cleared data). If the silent re-sync fails, surface the card
      // with the reason instead of dying quietly.
      ensurePushSubscription(uid).then((outcome) => {
        if (!outcome.ok) {
          setFailReason(outcome.reason);
          setState("ask");
        }
      });
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time environment sniff on mount
    setState(Notification.permission === "denied" ? "blocked" : "ask");
  }, [uid]);

  if (state === "hidden") return null;

  async function enable() {
    if (phase === "busy" || phase === "check" || phase === "fold") return;
    setPhase("busy");
    let outcome: Awaited<ReturnType<typeof requestPushPermission>>;
    try {
      outcome = await requestPushPermission(uid);
    } catch (e) {
      outcome = { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    if (outcome.ok) {
      setPhase("check");
      setTimeout(() => setPhase("fold"), 700);
      setTimeout(() => setState("hidden"), 1250);
    } else {
      // Hard deny means the OS won't re-prompt — switch to the Settings copy
      // instead of a "try again" that would silently do nothing.
      if (Notification.permission === "denied") setState("blocked");
      setFailReason(outcome.reason);
      setPhase("error");
      setTimeout(() => setPhase("idle"), 1100);
    }
  }

  const leaving = phase === "check" || phase === "fold";

  return (
    <div
      className={`mx-2.5 grid transition-all duration-500 ease-in-out ${
        phase === "fold" ? "mt-0 grid-rows-[0fr] opacity-0" : "mt-2.5 grid-rows-[1fr]"
      }`}
    >
      {/* overflow-hidden only while folding — it would clip the red glow */}
      <div className={`min-h-0 ${phase === "fold" ? "overflow-hidden" : ""}`}>
        <div
          className={`relative flex items-center gap-3 rounded-lg border-[0.5px] border-edge bg-card p-3.5 ${
            phase === "error" ? "animate-[banner-error_1.1s_ease-out]" : ""
          }`}
        >
          <div
            className={`flex min-w-0 flex-1 items-center gap-3 transition-opacity duration-300 ${
              leaving ? "opacity-0" : ""
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6 shrink-0 text-mut"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold">
                {state === "blocked" ? "Notifications are off" : "Turn on notifications"}
              </p>
              <p
                className={`mt-0.5 text-[11px] leading-snug ${
                  failReason && state !== "blocked" ? "text-heart" : "text-meta"
                }`}
              >
                {state === "blocked"
                  ? `Enable them in Settings → Notifications → ${site().siteName} to know when friends post.`
                  : failReason
                    ? `Enabling notifications failed (${failReason}). Try again.`
                    : "Know the second a friend posts."}
              </p>
            </div>
            {state === "ask" && (
              <button
                onClick={enable}
                disabled={phase === "busy"}
                className="shrink-0 rounded-lg bg-white px-3.5 py-2 text-xs font-extrabold text-black transition-opacity active:opacity-75 disabled:opacity-60"
              >
                Enable
              </button>
            )}
          </div>
          {leaving && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#30d158] animate-[check-pop_0.5s_cubic-bezier(0.22,1.4,0.36,1)_both]">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5 text-black"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
