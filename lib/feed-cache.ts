"use client";

import { useEffect, useState } from "react";
import { db, collection, getDocs } from "./store";
import type { QueryDocumentSnapshot, DocumentData } from "./store";
import type { Post } from "./posts";

// The feed page unmounts on every navigation (notifications, a profile, a
// post permalink), and refetching from the top would dump the reader back at
// the newest post. This module-level snapshot survives navigations within
// the session so the feed can restore exactly what was on screen — posts,
// pagination cursor, and scroll offset.
//
// Anything that changes what the feed should show (new post, rename, block)
// must call invalidateFeedCache() so the next visit refetches.

export type FeedSnapshot = {
  posts: Post[];
  cursor?: QueryDocumentSnapshot<DocumentData>;
  hasMore: boolean;
  // Where you were, anchored to a post rather than a pixel. A raw offset
  // lands in the wrong place on the way back: comment previews refetch and
  // photos stored without dimensions start as a square, so everything above
  // the fold re-measures and the same number points at a different photo.
  // Pinning the post that was under the top edge — and how far under — makes
  // the restore immune to whatever the height above it does.
  anchorId?: string;
  anchorOffset?: number;
  scrollTop: number; // fallback when the anchored post is gone (deleted, blocked)
  uid: string; // owner — a different account signing in must not inherit it
};

let snapshot: FeedSnapshot | null = null;

export function saveFeedSnapshot(next: FeedSnapshot) {
  snapshot = next;
}

export function readFeedSnapshot(uid: string): FeedSnapshot | null {
  return snapshot && snapshot.uid === uid ? snapshot : null;
}

// /browse reads every photo doc in one query to filter and sort the archive
// locally. That's the largest read in the app, and it used to run again on
// every visit — hold it for the session instead. Same invalidation rules as
// the feed snapshot: anything that changes what should be shown clears it.
let archive: Post[] | null = null;
// When that copy landed. A session is not a page load here — this is a PWA
// that sits open for days on a home screen — so the copy also has to be able
// to age out on its own, or a friend who posted this morning wouldn't show up
// until something happened to invalidate it.
let archiveAt = 0;

export function readArchive(): Post[] | null {
  return archive;
}

// How long a session copy is trusted before the next thing to ask for it
// triggers a background refetch. Short enough that the group's morning shows
// up on the first look at the app, long enough that flicking between tabs
// doesn't re-read the whole collection every time.
const ARCHIVE_MAX_AGE_MS = 3 * 60 * 1000;

export function archiveIsStale(): boolean {
  return !archive || Date.now() - archiveAt > ARCHIVE_MAX_AGE_MS;
}

// Anything derived from the archive holds it in component state, so dropping
// the module copy isn't enough on its own: a card already on screen would go
// on showing whatever it mounted with. Invalidating therefore also wakes the
// views built on it, and they reload.
const watchers = new Set<() => void>();

export function watchArchive(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

// Copied first: a watcher is free to unsubscribe while being woken.
function wakeWatchers() {
  for (const wake of [...watchers]) wake();
}

// Phones don't reload pages, they get put in pockets. Coming back to an app
// that has been open since yesterday should show yesterday being over, not
// the standings it went to sleep on. One listener for the whole app rather
// than one per mounted card — they all reload off the same wake anyway.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && archiveIsStale()) wakeWatchers();
  });
}

// The archive metadata also persists to localStorage (photos themselves are
// not stored — just docs, ~100KB for the whole archive), so a cold PWA launch
// paints /browse instantly from the last visit while a background refetch
// replaces it. Deliberately NOT cleared by invalidateFeedCache(): it's only
// ever served stale-while-revalidate, so a stale copy costs a second of
// staleness, never a wrong steady state.
const ARCHIVE_KEY = "browse-archive-v1";

// Compact wire form. `t` is the stored timestamp in milliseconds.
type StoredPost = {
  id: string;
  u?: string; // userUUID
  n?: string; // username
  imagePath: string;
  cap?: string;
  t: number;
  c?: number; // capturedAt millis
  likedBy?: string[];
  w?: number;
  h?: number;
};

const reviveTs = (ms: number) => ({ toDate: () => new Date(ms) });

export function readStoredArchive(): Post[] | null {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredPost[];
    if (!Array.isArray(stored) || stored.length === 0) return null;
    return stored.map((s) => ({
      id: s.id,
      userUUID: s.u ?? "",
      username: s.n ?? "",
      imagePath: s.imagePath,
      caption: s.cap ?? "",
      timestamp: reviveTs(s.t),
      likedBy: s.likedBy ?? [],
      ...(s.w && s.h ? { imageWidth: s.w, imageHeight: s.h } : {}),
      ...(s.c ? { capturedAt: reviveTs(s.c) } : {}),
    }));
  } catch {
    return null;
  }
}

export function saveArchive(posts: Post[]) {
  archive = posts;
  archiveAt = Date.now();
  try {
    const stored: StoredPost[] = posts
      .filter((p) => p.timestamp)
      .map((p) => ({
        id: p.id,
        ...(p.userUUID ? { u: p.userUUID } : {}),
        ...(p.username ? { n: p.username } : {}),
        imagePath: p.imagePath,
        ...(p.caption ? { cap: p.caption } : {}),
        t: p.timestamp!.toDate().getTime(),
        ...(p.capturedAt?.toDate ? { c: p.capturedAt.toDate().getTime() } : {}),
        ...(p.likedBy?.length ? { likedBy: p.likedBy } : {}),
        ...(p.imageWidth && p.imageHeight ? { w: p.imageWidth, h: p.imageHeight } : {}),
      }));
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(stored));
  } catch {
    // Quota or privacy mode — the session cache still works.
  }
}

// Several callers want the whole archive — /browse, to filter and sort it,
// the like standings on every profile, the posting streaks beside every name —
// and they must never pay for it twice. Resolves from the session cache when
// it's warm, otherwise runs the one query and holds it so a second caller in
// the same breath joins in rather than firing its own.
let inflight: Promise<Post[]> | null = null;

export function fetchArchive(): Promise<Post[]> {
  const cached = readArchive();
  if (cached && !archiveIsStale()) return Promise.resolve(cached);
  inflight ??= getDocs(collection(db, "photos"))
    .then((snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Post)
        .filter((p) => p.timestamp && p.deleted !== true);
      saveArchive(list);
      inflight = null;
      return list;
    })
    .catch((err) => {
      // A failed fetch must not be remembered as the answer.
      inflight = null;
      throw err;
    });
  return inflight;
}

// The archive, stale-while-revalidate: the session copy if there is one, else
// last visit's persisted copy on screen at once while the fresh query replaces
// it. Same deal /browse runs on — a medal (or a flame) that settles a beat
// late beats a line that pops in blank.
//
// Shared by everything derived from the whole archive — the like standings on
// a profile, the streak beside a name — so they all read the same copy and
// only the first of them ever pays for the query.
//
// It reloads on its own in the two cases where the copy in hand has stopped
// being the truth: something invalidated the cache (you posted, you pulled to
// refresh, you blocked someone), or the app came back to the foreground with
// an aging copy. Without that, a streak counted at breakfast would still be
// on screen at dinner — the flames have to move when the group does.
export function useArchive(enabled: boolean): Post[] | null {
  const [posts, setPosts] = useState<Post[] | null>(null);
  // Bumped to re-run the load below; the load itself is idempotent and shares
  // one query across every view that asks in the same breath.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    return watchArchive(() => setReloads((n) => n + 1));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const cached = readArchive();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session-cache restore
    if (cached) setPosts(cached);
    // Only ever fall back to last visit's persisted copy when there is
    // nothing on screen yet: on a reload we already hold something newer
    // than the device cache, and swapping it out would be a step backwards.
    else setPosts((current) => current ?? readStoredArchive());
    if (cached && !archiveIsStale()) return;

    let cancelled = false;
    fetchArchive()
      .then((list) => {
        if (!cancelled) setPosts(list);
      })
      // Offline: the copy in hand (if any) stands, and without one the
      // standings simply stay quiet rather than erroring out a profile.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, reloads]);

  return posts;
}

export function invalidateFeedCache() {
  snapshot = null;
  archive = null;
  archiveAt = 0;
  wakeWatchers();
}
