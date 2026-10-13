"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { db, doc, getDoc } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { useBlockSets } from "@/lib/blocks";
import type { Post } from "@/lib/posts";
import PhotoCard from "@/components/PhotoCard";
import CommentSheet from "@/components/CommentSheet";
import UploadSheet from "@/components/UploadSheet";
import PageHeader from "@/components/PageHeader";
import BottomNav from "@/components/BottomNav";
import ViewportShell from "@/components/ViewportShell";

// Single-post view — where notification taps land, and a shareable
// in-app permalink for any photo.
export default function PostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = use(params);
  const { user, username, loading } = useAuth();
  const router = useRouter();
  // undefined = fetching, null = gone/never existed
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [activeComments, setActiveComments] = useState<Post | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [commentBump, setCommentBump] = useState(0);
  const { hidden, ready: blocksReady } = useBlockSets(user?.uid);
  // Comment-notification taps land here with ?comments=1. Read once on mount;
  // the sheet opens further down, only once the post has cleared blocks.
  const [wantsComments] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("comments") === "1"
  );
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDoc(doc(db, "photos", postId))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.exists() ? ({ id: snap.id, ...snap.data() } as Post) : null;
        // Soft-deleted posts read as gone, same as hard-deleted ones.
        setPost(data && data.deleted !== true ? data : null);
      })
      .catch(() => {
        if (!cancelled) setPost(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, postId]);

  // Every list in the app filters blocked posters, but a permalink has no
  // list in front of it — it's reached by a raw link or an old notification,
  // so the check has to happen here or blocking has a hole you can walk
  // through. Waiting on `ready` matters: the block lists arrive a beat after
  // the post does, and rendering optimistically would flash the photo first.
  const resolving = post === undefined || !blocksReady;
  const gone = !resolving && (post === null || Boolean(post.userUUID && hidden.has(post.userUUID)));
  const visiblePost = !resolving && !gone ? post : null;

  // Pop the thread open for a comment-notification tap — but only for a post
  // that survived the checks above, so a stale link can't open a blocked
  // person's comments behind the dead-end message. Done during render rather
  // than in an effect (same idiom as PhotoCard's resync) so the sheet is
  // already open on the first paint that shows the post. Once only: closing
  // the sheet must not immediately reopen it.
  if (wantsComments && !autoOpened && visiblePost) {
    setAutoOpened(true);
    setActiveComments(visiblePost);
  }

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
      <PageHeader backHref="/" title="Post" />

      <main className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-contain pt-[calc(52px+env(safe-area-inset-top))]">
        {resolving && (
          <p className="py-10 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            Loading
          </p>
        )}

        {gone && (
          <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
            <p className="text-sm text-mut">This post is gone — it may have been deleted.</p>
            <Link
              href="/"
              className="rounded-lg border-[0.5px] border-edge px-6 py-2.5 text-[11px] font-bold uppercase tracking-[1.5px] text-mut transition-colors hover:border-mut hover:text-white"
            >
              Back to feed
            </Link>
          </div>
        )}

        {visiblePost && (
          <PhotoCard
            post={visiblePost}
            uid={user.uid}
            username={username || "Anonymous"}
            commentsVersion={commentBump}
            onOpenComments={setActiveComments}
            onDeleted={() => router.replace("/")}
          />
        )}
      </main>

      <BottomNav onCapture={setCapturedFile} />
      </ViewportShell>

      {activeComments && (
        <CommentSheet
          post={activeComments}
          uid={user.uid}
          username={username || "Anonymous"}
          onClose={() => setActiveComments(null)}
          onChanged={() => setCommentBump((b) => b + 1)}
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
            router.push("/");
          }}
        />
      )}
    </>
  );
}
