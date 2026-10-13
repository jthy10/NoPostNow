"use client";

import { useEffect, useState } from "react";
import { db, doc, getDoc } from "@/lib/store";
import { useAuthedImage } from "@/lib/use-authed-image";

// Small square preview of a post's photo, used inline on notification rows so
// every row shows which photo it's about. Resolves postId -> imagePath once
// per session; deleted posts resolve to null and render nothing.
const pathCache = new Map<string, Promise<string | null>>();

function imagePathFor(postId: string): Promise<string | null> {
  let hit = pathCache.get(postId);
  if (!hit) {
    hit = getDoc(doc(db, "photos", postId))
      .then((snap) =>
        snap.exists() && snap.data().deleted !== true
          ? (snap.data().imagePath as string) ?? null
          : null
      )
      .catch(() => null);
    pathCache.set(postId, hit);
  }
  return hit;
}

export default function PostThumb({
  postId,
  className = "h-10 w-10",
}: {
  postId: string;
  className?: string;
}) {
  // Tagged with the postId it belongs to so a recycled row doesn't briefly
  // show the previous post's photo — and so "still resolving" (no entry yet)
  // stays distinct from "this post has no photo" (an entry with a null path).
  const [entry, setEntry] = useState<{ postId: string; path: string | null } | null>(null);
  // Even the compressed copy is a full display-size photo, so a page of
  // notifications must not pull one per row up front just to fill a 40px
  // square. Fetching waits until the row is at least near the viewport.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const [node, setNode] = useState<HTMLElement | null>(null);

  const resolved = entry?.postId === postId ? entry : null;
  const src = useAuthedImage(resolved?.path ?? null, true); // compressed display copy

  useEffect(() => {
    if (near || !node) return;
    const io = new IntersectionObserver(
      (entries) => {
        // One-way latch: once it's been near, it keeps its photo.
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [near, node]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    imagePathFor(postId).then((path) => {
      if (!cancelled) setEntry({ postId, path });
    });
    return () => {
      cancelled = true;
    };
  }, [near, postId]);

  // A deleted post has nothing to show; give the row its width back.
  if (resolved && !resolved.path) return null;

  // Hold the slot while the doc and then the bytes load, so the text beside it
  // doesn't reflow the moment the photo lands.
  if (!src) {
    return (
      <span ref={setNode} aria-hidden className={`shrink-0 rounded-md bg-card ${className}`} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={setNode}
      src={src}
      alt=""
      className={`shrink-0 rounded-md border-[0.5px] border-edge object-cover ${className}`}
    />
  );
}
