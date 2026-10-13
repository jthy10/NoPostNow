"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Timestamp } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import {
  useNotifications,
  markNotificationsSeen,
  getNotificationsSeenAt,
  timeAgo,
  type NotificationItem,
} from "@/lib/notifications";
import { useBlockSets } from "@/lib/blocks";
import { useNamesByUid } from "@/lib/users";
import Avatar from "@/components/Avatar";
import PostThumb from "@/components/PostThumb";
import PageHeader from "@/components/PageHeader";
import BottomNav from "@/components/BottomNav";
import UploadSheet from "@/components/UploadSheet";
import ViewportShell from "@/components/ViewportShell";

const PAGE = 50;

// The actor's name, rendered as a link to their profile when we know their uid
// (relative z-10 so it sits above the row-covering permalink Link — see below).
// `name` is resolved live from the actor's uid (see useNamesByUid), so a
// renamed friend reads correctly here even though the stored actorName is a
// snapshot from when the notification was written.
function actorLabel(name: string, profileHref: string | null) {
  return profileHref ? (
    <Link href={profileHref} className="relative z-10 font-bold hover:underline">
      {name}
    </Link>
  ) : (
    <b>{name}</b>
  );
}

function rowText(n: NotificationItem, name: string, profileHref: string | null) {
  const who = actorLabel(name, profileHref);
  switch (n.type) {
    case "post":
      return n.text ? (
        <>
          {who} posted — &ldquo;{n.text}&rdquo;
        </>
      ) : (
        <>{who} posted a photo</>
      );
    case "comment":
      return (
        <>
          {who} commented: &ldquo;{n.text}&rdquo;
        </>
      );
    case "like":
      return <>{who} liked your photo</>;
    case "mention":
      return (
        <>
          {who} mentioned you: &ldquo;{n.text}&rdquo;
        </>
      );
    case "commentLike":
      return <>{who} liked your comment</>;
  }
}

// Where a notification tap lands: anything about a comment thread (a comment,
// an @mention, a comment-like) deep-links to the open thread; posts and photo
// likes land on the post permalink.
function notifHref(n: NotificationItem) {
  return n.type === "comment" || n.type === "mention" || n.type === "commentLike"
    ? `/p/${n.postId}?comments=1`
    : `/p/${n.postId}`;
}

export default function NotificationsPage() {
  const { user, username, loading } = useAuth();
  const router = useRouter();
  const [max, setMax] = useState(PAGE);
  const items = useNotifications(user?.uid, max);
  const { hidden } = useBlockSets(user?.uid);
  const names = useNamesByUid();
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  // What "new" meant when the page opened — rows after this line get a dot.
  // Frozen once so rows don't lose their highlight mid-look when we mark seen.
  const [openedSeenAt, setOpenedSeenAt] = useState<Timestamp | null | undefined>(undefined);
  const lastMarked = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getNotificationsSeenAt(user.uid).then((t) => {
      if (!cancelled) setOpenedSeenAt(t);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Everything visible counts as seen — including items that arrive while
  // the page is open (guarded by head id so it's one write per new item).
  // Waits for openedSeenAt so marking seen can't race the highlight snapshot.
  useEffect(() => {
    if (!user || openedSeenAt === undefined || !items || items.length === 0) return;
    const head = items[0].id;
    if (lastMarked.current === head) return;
    lastMarked.current = head;
    void markNotificationsSeen(user.uid);
  }, [user, items, openedSeenAt]);

  // Blocked either way — their activity shouldn't surface here.
  const visibleItems = useMemo(
    () => items?.filter((n) => !hidden.has(n.actorUid)) ?? null,
    [items, hidden]
  );

  if (loading || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  const isNew = (n: NotificationItem) =>
    openedSeenAt !== undefined &&
    Boolean(n.at) &&
    (!openedSeenAt || n.at!.toMillis() > openedSeenAt.toMillis());

  return (
    <>
      <ViewportShell>
      <PageHeader
        backHref="/"
        title="Notifications"
        right={
          <>
            <Link
              href="/search"
              aria-label="Search people"
              className="p-1.5 text-white transition-opacity active:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-[22px] w-[22px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </Link>
            <Link
              href="/browse"
              aria-label="Browse the archive"
              className="p-1.5 text-white transition-opacity active:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-[22px] w-[22px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </Link>
          </>
        }
      />

      {/* Same scroller structure as the feed — a plain flex-1 div does the
          scrolling so every notification is reachable on iOS. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <main className="mx-auto w-full max-w-lg pb-8 pt-[calc(52px+env(safe-area-inset-top))]">
        {visibleItems === null && (
          <p className="py-10 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            Loading
          </p>
        )}

        {visibleItems?.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8 text-dim"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p className="text-sm text-mut">
              Nothing yet — likes, comments, and new posts show up here.
            </p>
          </div>
        )}

        {visibleItems?.map((n) => {
          const actorName = names.get(n.actorUid) ?? n.actorName;
          // Actor is never you (we never write into your own feed), so any
          // uid links straight to /u/{uid}; legacy rows without a uid stay plain.
          const profileHref = n.actorUid ? `/u/${n.actorUid}` : null;
          return (
          // A row-covering Link handles the default tap (to the post/thread);
          // the avatar and name are relative z-10 so they win their own taps
          // and route to the actor's profile instead. Avoids nesting <a>s.
          <div
            key={n.id}
            className="relative flex items-center gap-3 border-b-[0.5px] border-field px-4 py-3.5 transition-colors active:bg-card"
          >
            <Link
              href={notifHref(n)}
              aria-label="Open"
              className="absolute inset-0"
            />
            {profileHref ? (
              <Link
                href={profileHref}
                aria-label={`View ${actorName}'s profile`}
                className="relative z-10 shrink-0"
              >
                <Avatar username={actorName} className="h-10 w-10 text-xs" />
              </Link>
            ) : (
              <Avatar username={actorName} className="h-10 w-10 text-xs" />
            )}
            <p className="min-w-0 flex-1 break-words text-[13px] leading-snug text-body">
              {rowText(n, actorName, profileHref)}{" "}
              <span className="whitespace-nowrap text-[11px] text-meta">
                {timeAgo(n.at)}
              </span>
            </p>
            {isNew(n) && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-heart" aria-label="New" />
            )}
            {/* Every notification is about a post, so every row previews it —
                not just the likes. */}
            <PostThumb postId={n.postId} />
          </div>
          );
        })}

        {items && items.length >= max && (
          <button
            onClick={() => setMax((m) => m + PAGE)}
            className="mx-auto my-6 block rounded-lg border-[0.5px] border-edge px-6 py-2.5 text-[11px] font-bold uppercase tracking-[1.5px] text-mut transition-colors hover:border-mut hover:text-white"
          >
            Load More
          </button>
        )}
      </main>
      </div>

      <BottomNav onCapture={setCapturedFile} />
      </ViewportShell>

      {capturedFile && (
        <UploadSheet
          file={capturedFile}
          uid={user.uid}
          username={username || "Anonymous"}
          onClose={() => setCapturedFile(null)}
          onPosted={() => {
            setCapturedFile(null);
            router.push("/");
          }}
        />
      )}
    </>
  );
}
