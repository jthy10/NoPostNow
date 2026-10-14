"use client";

import PageHeader from "./PageHeader";
import InstallBanner from "./InstallBanner";
import ViewportShell from "./ViewportShell";
import { site } from "@/lib/site";

// DMs are app-only. Anyone who lands on /dm from a browser tab gets the
// pitch instead: what it is, and exactly how to get it. InstallBanner
// renders the platform-specific install steps on phones (null on desktop).
export default function DmInstallPitch() {
  return (
    <ViewportShell>
      <PageHeader backHref="/notifications" title="Messages" />
      {/* Its own full-width scroller, like every other page — in landscape
          the pitch is taller than the screen. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <main className="mx-auto w-full max-w-lg pb-[90px] pt-[calc(52px+env(safe-area-inset-top))]">
        <div className="flex flex-col items-center gap-3 px-8 pb-4 pt-14 text-center">
          <svg
            viewBox="0 0 24 24"
            className="h-9 w-9 text-dim"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <p className="text-base font-extrabold">Messages live in the app</p>
          <p className="text-[13px] leading-relaxed text-mut">
            Install {site().siteName} on your Home Screen to send and read DMs — you&apos;ll
            get a notification the second a friend messages you.
          </p>
        </div>
        <InstallBanner />
        <p className="px-8 pt-3 text-center text-[11px] leading-relaxed text-dim sm:block hidden">
          On your phone, open this site in your browser and add it to your Home Screen.
        </p>
      </main>
      </div>
    </ViewportShell>
  );
}
