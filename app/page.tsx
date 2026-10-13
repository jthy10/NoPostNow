"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { fetchPosts, invalidateAllCommentPreviews, type Post } from "@/lib/posts";
import { useBlockSets } from "@/lib/blocks";
import { invalidateAvatarMap } from "@/lib/users";
import {
  invalidateFeedCache,
  readFeedSnapshot,
  saveFeedSnapshot,
  type FeedSnapshot,
} from "@/lib/feed-cache";
import PhotoCard from "@/components/PhotoCard";
import CommentSheet from "@/components/CommentSheet";
import UploadSheet from "@/components/UploadSheet";
import TopNav from "@/components/TopNav";
import BottomNav from "@/components/BottomNav";
import InstallBanner from "@/components/InstallBanner";
import DmInviteBanner from "@/components/DmInviteBanner";
import FeedPromo from "@/components/FeedPromo";
import NotificationsCard from "@/components/NotificationsCard";
import AnnouncementCard from "@/components/AnnouncementCard";
import PullToRefresh from "@/components/PullToRefresh";
import ViewportShell from "@/components/ViewportShell";
import type { QueryDocumentSnapshot, DocumentData } from "@/lib/store";
import { isSpecialDate, specialDateLabel } from "@/lib/site";

// The post sitting under the scroller's top edge, and how far past it we've
// scrolled — the pair that says "here" in a way that survives everything
// above it changing height.
function readAnchor(scroller: HTMLElement | null) {
  if (!scroller) return {};
  const edge = scroller.getBoundingClientRect().top;
  for (const el of scroller.querySelectorAll<HTMLElement>("[data-post-id]")) {
    const { top, bottom } = el.getBoundingClientRect();
    if (bottom > edge) return { anchorId: el.dataset.postId, anchorOffset: top - edge };
  }
  return {};
}

export default function FeedPage() {
  const { user, username, loading } = useAuth();
  const router = useRouter();

  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [activeComments, setActiveComments] = useState<Post | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [commentBumps, setCommentBumps] = useState<Record<string, number>>({});
  // Bumped by a hard refresh; added to each card's commentsVersion so every
  // mounted card refetches its (just-cleared) comment preview.
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Set once the feed holds real data (restored or fetched) — before that,
  // the empty initial state must not clobber a good session snapshot.
  const seeded = useRef(false);
  // Position waiting to be applied — only after the restored posts have
  // actually committed; scrolling the still-empty list would clamp to 0.
  const pendingScroll = useRef<FeedSnapshot | null>(null);
  // Live copies for the unmount save — saving from an effect on every state
  // change would race StrictMode's double-mount and clobber a good snapshot
  // with the initial empty state.
  const lastScrollTop = useRef(0);
  // Kept fresh on scroll rather than read at unmount: by the time the save
  // cleanup runs, the cards it would have to measure are already gone.
  const lastAnchor = useRef<Pick<FeedSnapshot, "anchorId" | "anchorOffset">>({});
  const latest = useRef({ posts, cursor, hasMore });
  useEffect(() => {
    latest.current = { posts, cursor, hasMore };
  });
  const { blocked, hidden } = useBlockSets(user?.uid);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const loadMore = useCallback(async () => {
    if (fetching || !hasMore) return;
    setFetching(true);
    const { posts: next, nextCursor } = await fetchPosts(cursor);
    seeded.current = true;
    // Dedupe on append: StrictMode's double-mount (and any rapid sentinel
    // re-trigger) can land two overlapping fetches before `fetching` commits.
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...next.filter((p) => !seen.has(p.id))];
    });
    setCursor(nextCursor);
    setHasMore(Boolean(nextCursor));
    setFetching(false);
  }, [cursor, fetching, hasMore]);

  // Reload from the top (after posting a new photo, or pull-to-refresh).
  const refresh = useCallback(async () => {
    setFetching(true);
    const { posts: next, nextCursor } = await fetchPosts();
    seeded.current = true;
    setPosts(next);
    setCursor(nextCursor);
    setHasMore(Boolean(nextCursor));
    setFetching(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  // The reset closing-and-reopening the PWA gives you, without the relaunch:
  // drop every session cache (feed snapshot, comment previews, names/avatars)
  // and refetch from the top. FEED tap and pull-to-refresh both land here.
  const hardRefresh = useCallback(async () => {
    invalidateFeedCache();
    invalidateAllCommentPreviews();
    invalidateAvatarMap();
    setRefreshEpoch((e) => e + 1);
    await refresh();
  }, [refresh]);

  // First load: restore the session snapshot (posts + scroll offset) so
  // coming back from notifications/profiles doesn't dump you at the top;
  // fetch fresh only when there's nothing to restore.
  useEffect(() => {
    if (!user) return;
    const snap = readFeedSnapshot(user.uid);
    if (snap) {
      seeded.current = true;
      pendingScroll.current = snap;
      lastScrollTop.current = snap.scrollTop;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time session-cache restore
      setPosts(snap.posts);
      setCursor(snap.cursor);
      setHasMore(snap.hasMore);
    } else {
      loadMore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Put the anchored post back under the top edge in the same frame the posts
  // paint. Measuring the anchor's live position (rather than trusting the old
  // pixel offset) is what absorbs any height the cards above have gained or
  // lost since; whatever they do *after* this, the browser's own scroll
  // anchoring holds the view steady.
  useLayoutEffect(() => {
    const pending = pendingScroll.current;
    if (!pending || posts.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const anchor = pending.anchorId
      ? el.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(pending.anchorId)}"]`)
      : null;
    if (anchor && pending.anchorOffset !== undefined) {
      const delta =
        anchor.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        pending.anchorOffset;
      el.scrollTop += delta;
    } else {
      // Anchor deleted or blocked out from under us — the raw offset is a
      // worse landing spot, but it beats the top of the feed.
      el.scrollTop = pending.scrollTop;
    }
    // Carry the anchor forward so leaving again without scrolling still saves
    // a real position rather than falling back to the raw offset.
    lastAnchor.current = { anchorId: pending.anchorId, anchorOffset: pending.anchorOffset };
    pendingScroll.current = null;
  }, [posts]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Re-reading the anchor measures cards, so do it once per frame at most
    // rather than on every scroll event.
    let frame = 0;
    const onScroll = () => {
      lastScrollTop.current = el.scrollTop;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        lastAnchor.current = readAnchor(el);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [user]);

  // Snapshot on unmount — whatever was on screen is what the next visit
  // restores.
  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    return () => {
      // An empty list is never worth saving, and saving one is actively
      // harmful: StrictMode's double-mount runs this cleanup between the two
      // mounts, when `latest` still holds the initial empty render — writing
      // that over a good snapshot would wipe the restore before the second
      // mount reads it. A genuinely empty feed just refetches next visit.
      if (!seeded.current || latest.current.posts.length === 0) return;
      saveFeedSnapshot({
        ...latest.current,
        ...lastAnchor.current,
        scrollTop: lastScrollTop.current,
        uid,
      });
    };
  }, [user]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: scrollRef.current }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // Blocking is mutual invisibility — filter at render so the cached list
  // stays intact and an unblock brings posts back instantly.
  const visiblePosts = useMemo(
    () => posts.filter((p) => !p.userUUID || !hidden.has(p.userUUID)),
    [posts, hidden]
  );

  if (loading || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  return (
    <>
      <ViewportShell>
      <TopNav scrollRef={scrollRef} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <PullToRefresh onRefresh={hardRefresh} scrollRef={scrollRef}>
      <main className="mx-auto w-full max-w-lg pt-[calc(52px+env(safe-area-inset-top))]">
        {isSpecialDate(new Date()) && (
          <div
            role="status"
            className="mx-4 mt-4 overflow-hidden rounded-lg border border-[#ffd88a]/55 bg-[radial-gradient(circle_at_top_left,rgba(255,216,138,0.28),rgba(255,190,84,0.08)_55%,rgba(17,17,17,0.96))] px-4 py-3 shadow-[0_0_24px_rgba(255,190,84,0.16)]"
          >
            <div className="flex items-center justify-center gap-2 text-[#ffd88a]">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
                <path d="M12 2l2.35 5.76L20.5 8.3l-4.7 4.02 1.5 6.18L12 15.6 6.7 18.5l1.5-6.18L3.5 8.3l6.15-.54z" />
              </svg>
              <p className="text-sm font-extrabold uppercase tracking-[1.5px]">
                Happy {specialDateLabel()}!
              </p>
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
                <path d="M12 2l2.35 5.76L20.5 8.3l-4.7 4.02 1.5 6.18L12 15.6 6.7 18.5l1.5-6.18L3.5 8.3l6.15-.54z" />
              </svg>
            </div>
          </div>
        )}
        <DmInviteBanner uid={user.uid} />
        <InstallBanner />
        <NotificationsCard uid={user.uid} />
        <AnnouncementCard />

        {visiblePosts.map((post, i) => (
          // data-post-id is what readAnchor pins the scroll position to.
          <div key={post.id} data-post-id={post.id}>
            <PhotoCard
              post={post}
              uid={user.uid}
              username={username || "Anonymous"}
              commentsVersion={(commentBumps[post.id] ?? 0) + refreshEpoch}
              onOpenComments={setActiveComments}
              onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
            />
            {/* Install nudges between every 4th post for browser users */}
            {(i + 1) % 4 === 0 && (
              <FeedPromo
                index={(i + 1) / 4 - 1}
                onScrollToTop={() =>
                  scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
                }
              />
            )}
          </div>
        ))}

        <div ref={sentinelRef} className="h-10" />

        {fetching && (
          <p className="pb-6 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            Loading
          </p>
        )}

        {!hasMore && visiblePosts.length > 0 && (
          <p className="pb-8 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            You&apos;re all caught up
          </p>
        )}

        {!hasMore && visiblePosts.length === 0 && (
          <p className="py-10 text-center text-sm text-mut">
            {blocked.size > 0 ? "No posts to show." : "No posts yet."}
          </p>
        )}
      </main>
      </PullToRefresh>
      </div>

      <BottomNav onCapture={setCapturedFile} onRefresh={hardRefresh} scrollRef={scrollRef} />
      </ViewportShell>

      {activeComments && (
        <CommentSheet
          post={activeComments}
          uid={user.uid}
          username={username || "Anonymous"}
          onClose={() => setActiveComments(null)}
          onChanged={() =>
            setCommentBumps((m) => ({
              ...m,
              [activeComments.id]: (m[activeComments.id] ?? 0) + 1,
            }))
          }
        />
      )}

      {capturedFile && (
        <UploadSheet
          file={capturedFile}
          uid={user.uid}
          username={username || "Anonymous"}
          onClose={() => setCapturedFile(null)}
          onPosted={() => {
            setCapturedFile(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
