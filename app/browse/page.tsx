"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useBlockSets } from "@/lib/blocks";
import {
  archiveIsStale,
  fetchArchive,
  readArchive,
  readStoredArchive,
  saveArchive,
  watchArchive,
} from "@/lib/feed-cache";
import { estimateCardHeight, postDate, isMomentPost, type Post } from "@/lib/posts";
import { dailyMomentLabel, site } from "@/lib/site";
import { useVirtualList } from "@/lib/use-virtual-list";
import PhotoCard from "@/components/PhotoCard";
import CommentSheet from "@/components/CommentSheet";
import PageHeader from "@/components/PageHeader";
import ViewportShell from "@/components/ViewportShell";

// The archive: the same feed you already know, just with filter controls on
// top — pick a member, flip newest↔oldest, or narrow to the daily moment. All
// metadata loads in one query (the whole feed is a few hundred docs).
//
// Cards are windowed (useVirtualList): only the ones near the viewport are
// mounted, the rest are reserved space. Scrolling the full archive used to
// mount every card it passed and hold every photo's blob in memory at once —
// hundreds of megabytes deep into a few hundred posts, which is how an iOS
// PWA gets killed. The scrollbar still spans the whole archive.

// All three sorts sit in a segmented control — every option visible, one tap
// to any of them (the old single button cycled blindly through the list).
type SortMode = "new" | "old" | "liked";
const SORT_ORDER: SortMode[] = ["new", "old", "liked"];
const SORT_LABEL: Record<SortMode, string> = {
  new: "Newest",
  old: "Oldest",
  liked: "Most liked",
};

export default function BrowsePage() {
  const { user, username, loading } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [who, setWho] = useState<string | null>(null); // username filter
  const [onlyMoment, setOnlyMoment] = useState(false); // daily-moment posts only
  const [sort, setSort] = useState<SortMode>("new");
  const [activeComments, setActiveComments] = useState<Post | null>(null);
  const [commentBumps, setCommentBumps] = useState<Record<string, number>>({});
  const { hidden, ready: blocksReady } = useBlockSets(user?.uid);
  // Held back until the block lists land, so a blocked person never flashes.
  // The scroller is held in state, not a ref: this page renders a loading
  // screen first, so the element doesn't exist on the first render and a ref
  // would never tell the windowing hook that it eventually appeared.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  // Photos are capped at 80vh, so height estimates need the viewport.
  const [viewportHeight, setViewportHeight] = useState(800);

  useEffect(() => {
    const sync = () => setViewportHeight(window.innerHeight);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Bumped when the shared archive is invalidated, or the app comes back to
  // the foreground with an aging copy — the load below then runs again.
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (!user) return;
    return watchArchive(() => setReloads((n) => n + 1));
  }, [user]);

  // The whole archive in one query — cached for the session, so coming back
  // to Browse (or bouncing out to a post and back) is free. Cold launches
  // paint instantly from the persistent copy of the last visit while the
  // fresh query replaces it in the background (stale-while-revalidate).
  useEffect(() => {
    if (!user) return;
    const cached = readArchive();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- session-cache restore
      setPosts(cached);
      if (!archiveIsStale()) return;
    } else {
      // Instant paint from the device cache while the fresh query runs. The
      // fetch is shared with the profile like standings, so whichever page ran
      // first this session has already paid for it.
      // Only onto an empty screen: after an invalidation the list already up
      // is newer than the device copy, and swapping it in would step back.
      setPosts((current) => current ?? readStoredArchive());
    }
    let cancelled = false;
    fetchArchive()
      .then((list) => {
        if (!cancelled) setPosts(list);
      })
      // Offline: the stored copy (if any) stays up rather than erroring out.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, reloads]);

  // Member chips, busiest posters first. Username (not uid) is the filter
  // key so legacy Anonymous posts stay browsable too.
  const members = useMemo(() => {
    if (!posts || !blocksReady) return [];
    const counts = new Map<string, number>();
    for (const p of posts) {
      if (p.userUUID && hidden.has(p.userUUID)) continue;
      if (onlyMoment && !isMomentPost(p)) continue;
      const name = p.username || "Anonymous";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [posts, hidden, onlyMoment, blocksReady]);

  // One flat, sorted list — newest/oldest flips the whole feed by time, most-
  // liked ranks by like count (ties fall back to newest so the order is stable).
  const visiblePosts = useMemo(() => {
    if (!posts || !blocksReady) return [];
    const filtered = posts.filter(
      (p) =>
        (!p.userUUID || !hidden.has(p.userUUID)) &&
        (!who || (p.username || "Anonymous") === who) &&
        (!onlyMoment || isMomentPost(p))
    );
    const time = (p: Post) => postDate(p)?.getTime() ?? 0;
    if (sort === "liked") {
      return [...filtered].sort(
        (a, b) => (b.likedBy?.length ?? 0) - (a.likedBy?.length ?? 0) || time(b) - time(a)
      );
    }
    const dir = sort === "old" ? 1 : -1;
    return [...filtered].sort((a, b) => dir * (time(a) - time(b)));
  }, [posts, who, sort, hidden, onlyMoment, blocksReady]);

  // Cards unmount when they leave the window, taking their optimistic like
  // state with them — so the list keeps the authoritative copy. Also keeps the
  // "most liked" sort and the session cache honest.
  const patchPost = useCallback((postId: string, patch: Partial<Post>) => {
    setPosts((prev) => {
      if (!prev) return prev;
      const next = prev.map((p) => (p.id === postId ? { ...p, ...patch } : p));
      saveArchive(next); // idempotent assignment; safe from inside the updater
      return next;
    });
  }, []);

  // Only the cards near the viewport are mounted; the rest is reserved space.
  const list = useVirtualList({
    items: visiblePosts,
    getKey: (p) => p.id,
    estimate: (p, width) => estimateCardHeight(p, width, viewportHeight),
    scrollEl,
    containerRef: rowsRef,
    // Enough cushion that a fast fling doesn't outrun the mounted window.
    overscan: 3,
  });

  if (loading || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  // Any filter/sort change starts the list over from the top.
  const resetWindow = () => {
    scrollEl?.scrollTo({ top: 0 });
  };

  const chipCls = (active: boolean) =>
    `shrink-0 rounded-full border-[0.5px] px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
      active
        ? "border-white bg-white text-black"
        : "border-edge text-mut hover:border-mut hover:text-white"
    }`;

  return (
    <>
      <ViewportShell>
        <PageHeader
          backHref="/"
          title="Browse"
          right={
            site().dailyMoment.enabled ? (
            <button
              onClick={() => {
                setOnlyMoment((v) => !v);
                resetWindow();
              }}
              aria-pressed={onlyMoment}
              aria-label={onlyMoment ? `Showing only ${dailyMomentLabel()} posts` : `Show only ${dailyMomentLabel()} posts`}
              className={`flex items-center gap-1 rounded-full border-[0.5px] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.5px] transition-colors ${
                onlyMoment
                  ? "border-[#ffd88a] bg-[#ffd88a]/15 text-[#ffd88a]"
                  : "border-edge text-mut hover:border-[#ffd88a]/60 hover:text-[#ffd88a]"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current" aria-hidden>
                <path d="M12 2l2.35 5.76L20.5 8.3l-4.7 4.02 1.5 6.18L12 15.6 6.7 18.5l1.5-6.18L3.5 8.3l6.15-.54z" />
              </svg>
              {dailyMomentLabel()}
            </button>
            ) : undefined
          }
        />

        <div ref={setScrollEl} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <main className="mx-auto w-full max-w-lg pb-10 pt-[calc(52px+env(safe-area-inset-top))]">
            {/* Sort — segmented control, every option one tap away. */}
            <div className="px-4 pt-3" role="group" aria-label="Sort posts">
              <div className="flex w-fit rounded-full border-[0.5px] border-edge bg-card p-0.5">
                {SORT_ORDER.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setSort(m);
                      resetWindow();
                    }}
                    aria-pressed={sort === m}
                    className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.5px] transition-colors ${
                      sort === m ? "bg-white text-black" : "text-mut hover:text-white"
                    }`}
                  >
                    {SORT_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            {/* Member filter — scrolls horizontally, busiest posters first. */}
            <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 py-3">
              <button
                onClick={() => {
                  setWho(null);
                  resetWindow();
                }}
                className={chipCls(who === null)}
              >
                Everyone
              </button>
              {members.map(([name, count]) => (
                <button
                  key={name}
                  onClick={() => {
                    setWho((w) => (w === name ? null : name));
                    resetWindow();
                  }}
                  className={chipCls(who === name)}
                >
                  {name}
                  <span className={who === name ? "ml-1 opacity-60" : "ml-1 text-dim"}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* First-ever load (nothing cached yet): skeleton cards instead
                of a bare "Loading" line, so the page has its shape at once. */}
            {(posts === null || !blocksReady) && (
              <div className="px-2.5" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="border-b-[0.5px] border-field pb-3 pt-2.5">
                    <div className="aspect-square w-full animate-pulse rounded-lg bg-card" />
                    <div className="mt-3 flex items-center gap-2 px-1">
                      <div className="h-7 w-7 animate-pulse rounded-full bg-card" />
                      <div className="h-3 w-24 animate-pulse rounded bg-card" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {posts !== null && blocksReady && visiblePosts.length === 0 && (
              <p className="py-10 text-center text-sm text-mut">
                {onlyMoment
                  ? `No ${dailyMomentLabel()} posts yet — catch the clock at ${dailyMomentLabel()} to land one here.`
                  : "Nothing here yet."}
              </p>
            )}

            {/* Full-height spacer so the scrollbar spans the whole archive;
                the mounted slice is pushed down to where it really sits.
                Padding rather than a transform: PhotoCard can open a
                position:fixed sheet, and a transformed ancestor would make
                that sheet position against this box instead of the screen. */}
            <div style={{ height: list.totalHeight }}>
              <div ref={rowsRef} style={{ paddingTop: list.offsetTop }}>
                {list.visible.map(({ item: post, key }) => (
                  <div key={key} data-vkey={key}>
                    <PhotoCard
                      post={post}
                      uid={user.uid}
                      username={username || "Anonymous"}
                      commentsVersion={commentBumps[post.id] ?? 0}
                      onOpenComments={setActiveComments}
                      onLikeChange={(id, likedBy) => patchPost(id, { likedBy })}
                      onCaptionChange={(id, caption) => patchPost(id, { caption })}
                      onDeleted={(id) =>
                        setPosts((prev) => (prev ? prev.filter((p) => p.id !== id) : prev))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
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
    </>
  );
}
