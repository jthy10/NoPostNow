"use client";

import { useEffect, useState } from "react";
import { db, collection, getDocs, query, where } from "@/lib/store";
import { isStandalone } from "@/lib/push";
import { isThreadUnread, peerUidOf, type Thread } from "@/lib/dms";
import { site } from "@/lib/site";

// The DM invite hook: DMs only exist inside the installed app, so when
// someone messages a friend who's still on the website, this banner is how
// that friend finds out. Browser-only; disappears once the thread is read
// (which can only happen in the app). Checked once per feed load — no live
// listener needed for a nudge.
export default function DmInviteBanner({ uid }: { uid: string }) {
  const [senders, setSenders] = useState<string[] | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    let cancelled = false;
    getDocs(query(collection(db, "dms"), where("uids", "array-contains", uid)))
      .then((snap) => {
        if (cancelled) return;
        const unread = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Thread))
          .filter((t) => isThreadUnread(t, uid))
          .sort((a, b) => (b.lastAt?.toMillis() ?? 0) - (a.lastAt?.toMillis() ?? 0));
        const names = unread.map((t) => {
          const peer = peerUidOf(t.id, uid);
          return (peer && t.names?.[peer]) || "Someone";
        });
        setSenders([...new Set(names)]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (!senders || senders.length === 0) return null;

  const title =
    senders.length === 1
      ? `${senders[0]} sent you a DM`
      : `${senders[0]} + ${senders.length - 1} more sent you DMs`;

  return (
    <div className="mx-2.5 mt-2.5 flex items-center gap-3 rounded-lg border-[0.5px] border-edge bg-card p-3.5">
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6 shrink-0 text-heart"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-meta">
          Messages live in the {site().siteName} app — install it on your phone to read
          and reply.
        </p>
      </div>
    </div>
  );
}
