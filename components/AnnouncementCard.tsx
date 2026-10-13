"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { db, doc, getDoc } from "@/lib/store";
import { site } from "@/lib/site";

const DISMISS_KEY = "nopostnow:announcement-dismissed";

export type Announcement = {
  text: string;
  link?: string;
  active: boolean;
  updatedAt: { toDate: () => Date } | null;
};

// Admin-published banner pinned to the top of the feed (managed from /admin).
// Dismissing remembers the announcement's timestamp, so editing or
// re-publishing makes it reappear for everyone.
export default function AnnouncementCard() {
  const [ann, setAnn] = useState<Announcement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "config", "announcement"));
        if (cancelled || !snap.exists()) return;
        const a = snap.data() as Announcement;
        if (!a.active || !a.text?.trim()) return;
        const stamp = a.updatedAt?.toDate?.().getTime() ?? 0;
        if (localStorage.getItem(DISMISS_KEY) === String(stamp)) return;
        setAnn(a);
      } catch {
        // Announcement is decoration — never let it break the feed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ann) return null;

  function dismiss() {
    const stamp = ann?.updatedAt?.toDate?.().getTime() ?? 0;
    try {
      localStorage.setItem(DISMISS_KEY, String(stamp));
    } catch {
      /* private mode */
    }
    setAnn(null);
  }

  const body = (
    <p className="text-[13px] leading-relaxed text-body">{ann.text}</p>
  );

  return (
    <div className="mx-4 mt-4 rounded-lg border-[0.5px] border-edge bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[1.5px] text-mut">
            {site().siteName}
          </p>
          {ann.link ? (
            <Link href={ann.link} className="block">
              {body}
              <span className="mt-1.5 inline-block text-[11px] font-bold uppercase tracking-[1px] text-white">
                Open →
              </span>
            </Link>
          ) : (
            body
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="shrink-0 p-1 text-mut transition-colors hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
