"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { db, collection, getDocs, query, where } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { useUserByUid } from "@/lib/users";
import { threadIdFor } from "@/lib/dms";
import { useBlockSets, blockUser, unblockUser } from "@/lib/blocks";
import { countLikes, usePodium } from "@/lib/likes";
import { useStreaks } from "@/lib/streaks";
import type { Post } from "@/lib/posts";
import Avatar from "@/components/Avatar";
import LikeTotal from "@/components/LikeTotal";
import StreakFlame from "@/components/StreakFlame";
import PhotoCard from "@/components/PhotoCard";
import CommentSheet from "@/components/CommentSheet";
import UploadSheet from "@/components/UploadSheet";
import TopNav from "@/components/TopNav";
import BottomNav from "@/components/BottomNav";
import ViewportShell from "@/components/ViewportShell";

const PAGE = 6;

function joinedLabel(d: Date) {
  return d
    .toLocaleDateString(undefined, { month: "long", year: "numeric" })
    .toUpperCase();
}

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid: profileUid } = use(params);
  const { user, username, loading } = useAuth();
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const meta = useUserByUid(profileUid);
  const { blocked, blockedBy, hidden } = useBlockSets(user?.uid);
  const podium = usePodium(user?.uid);
  const streaks = useStreaks(user?.uid);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [activeComments, setActiveComments] = useState<Post | null>(null);
  const [commentBumps, setCommentBumps] = useState<Record<string, number>>({});
  const [showActions, setShowActions] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);

  const iBlockedThem = blocked.has(profileUid);
  const theyBlockedMe = blockedBy.has(profileUid);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Your own profile lives at /profile (avatar editing, sign out).
  useEffect(() => {
    if (user && user.uid === profileUid) router.replace("/profile");
  }, [user, profileUid, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // Equality-only query (no orderBy) so no composite index is needed;
    // a friend group's post count is small enough to sort client-side.
    getDocs(query(collection(db, "photos"), where("userUUID", "==", profileUid))).then(
      (snap) => {
        if (cancelled) return;
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Post))
          .filter((p) => p.timestamp && p.deleted !== true)
          .sort((a, b) => b.timestamp!.toDate().getTime() - a.timestamp!.toDate().getTime());
        setPosts(list);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [user, profileUid]);

  // Reveal more of the already-fetched list as the sentinel nears the
  // viewport — every post is loaded up front (see the query above), so
  // "loading more" is just widening the slice, no extra fetch involved.
  // Depends on posts: the sentinel only enters the DOM once the fetch
  // above resolves, so the observer must (re)attach after that, not just
  // once at mount when the ref is still null.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisible((v) => v + PAGE);
      },
      { root: scrollRef.current }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [posts, visible]);

  async function handleBlockToggle() {
    if (!user || blockBusy) return;
    if (!iBlockedThem && !confirm(`Block ${profileName ?? "this user"}? You won't see each other's posts or activity anymore.`)) {
      return;
    }
    setBlockBusy(true);
    try {
      if (iBlockedThem) await unblockUser(user.uid, profileUid);
      else await blockUser(user.uid, profileUid);
    } finally {
      setBlockBusy(false);
      setShowActions(false);
    }
  }

  if (loading || !user || user.uid === profileUid) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  // User docs self-heal uid on sign-in, so friends who haven't opened the
  // app since the update resolve through their posts instead.
  const profileName = meta?.username ?? posts?.[0]?.username ?? null;
  const earliestPost = posts?.length
    ? posts[posts.length - 1].timestamp!.toDate()
    : null;

  // Someone who blocked you gets a dead-end page, not their posts.
  if (theyBlockedMe) {
    return (
      <ViewportShell>
        <TopNav />
        <main className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-sm text-mut">This profile isn&apos;t available.</p>
        </main>
        <BottomNav onCapture={setCapturedFile} />
      </ViewportShell>
    );
  }

  return (
    <>
      <ViewportShell>
      <TopNav scrollRef={scrollRef} />

      <main ref={scrollRef} className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-contain pb-8 pt-[calc(52px+env(safe-area-inset-top))]">
        <div className="flex flex-col items-center border-b-[0.5px] border-field px-5 pb-5 pt-7">
          <Avatar
            username={profileName ?? "?"}
            className="mb-3.5 h-[88px] w-[88px] border-2 text-3xl"
          />

          <h1 className="text-xl font-extrabold tracking-[-0.3px]">
            {profileName ?? " "}
          </h1>
          {meta?.joinedAt ? (
            <p className="mt-1 text-xs text-mut">JOINED {joinedLabel(meta.joinedAt)}</p>
          ) : earliestPost ? (
            <p className="mt-1 text-xs text-mut">POSTING SINCE {joinedLabel(earliestPost)}</p>
          ) : null}
          {posts !== null && (
            <>
              <p className="mt-1 text-xs font-semibold tracking-[0.5px] text-mut">
                {posts.length} POST{posts.length === 1 ? "" : "S"}
              </p>
              <LikeTotal
                likes={countLikes(posts, hidden)}
                place={podium.get(profileUid) ?? null}
              />
              {/* Spelled out here rather than the bare number a name row
                  gets — the profile is where you come to read someone's
                  standing, and it sits in the same quiet uppercase as the
                  counts above it. */}
              <StreakFlame
                days={streaks.get(profileUid) ?? 0}
                label
                className="mt-1.5 text-xs tracking-[0.5px]"
              />
            </>
          )}

          <div className="mt-4 flex items-center gap-2">
            {/* Straight to the thread — same destination as the sheet's Send
                Message, just one tap instead of three. Hidden while they're
                blocked: /dm filters blocked peers out of the list, so the
                thread would vanish the moment you sent to it. */}
            {!iBlockedThem && (
              <button
                onClick={() => router.push(`/dm/${threadIdFor(user.uid, profileUid)}`)}
                aria-label={profileName ? `Message ${profileName}` : "Send message"}
                className="flex items-center rounded-lg border-[0.5px] border-edge px-4 py-2 text-mut transition-colors hover:border-mut hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </button>
            )}

            <button
              onClick={() => setShowActions(true)}
              aria-label="Profile options"
              className="flex items-center rounded-lg border-[0.5px] border-edge px-4 py-2 text-mut transition-colors hover:border-mut hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>

        {iBlockedThem ? (
          <div className="flex flex-col items-center gap-3 px-8 py-14 text-center">
            <p className="text-sm text-mut">
              You blocked {profileName ?? "this user"} — their posts are hidden.
            </p>
            <button
              onClick={handleBlockToggle}
              disabled={blockBusy}
              className="rounded-lg border-[0.5px] border-edge px-6 py-2.5 text-[11px] font-bold uppercase tracking-[1.5px] text-mut transition-colors hover:border-mut hover:text-white disabled:opacity-40"
            >
              {blockBusy ? "Unblocking…" : "Unblock"}
            </button>
          </div>
        ) : (
          <>
            {posts === null && (
              <p className="py-10 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
                Loading
              </p>
            )}

            {posts !== null && posts.length === 0 && (
              <p className="py-10 text-center text-sm text-mut">No posts yet.</p>
            )}

            {posts?.slice(0, visible).map((post) => (
              <PhotoCard
                key={post.id}
                post={post}
                uid={user.uid}
                username={username || "Anonymous"}
                commentsVersion={commentBumps[post.id] ?? 0}
                onOpenComments={setActiveComments}
                onDeleted={(id) => setPosts((prev) => prev?.filter((p) => p.id !== id) ?? null)}
              />
            ))}

            {posts !== null && visible < posts.length && (
              <div ref={sentinelRef} className="h-10" />
            )}
          </>
        )}
      </main>

      <BottomNav onCapture={setCapturedFile} />
      </ViewportShell>

      {showActions && (
        <div
          className="fixed inset-0 z-50 flex animate-[fade-in_0.2s_ease-out] flex-col justify-end bg-black/60"
          onClick={() => setShowActions(false)}
        >
          <div
            className="animate-[sheet-up_0.25s_ease-out] rounded-t-[14px] bg-[#1c1c1e] pb-[calc(32px+env(safe-area-inset-bottom))] pt-2"
            onClick={(e) => e.stopPropagation()}
          >
            {!iBlockedThem && (
              <button
                onClick={() => router.push(`/dm/${threadIdFor(user.uid, profileUid)}`)}
                className="block w-full border-t-[0.5px] border-[#2c2c2e] px-5 py-4 text-left text-[17px] font-semibold text-white transition-colors active:bg-[#28282a]"
              >
                Send Message
              </button>
            )}
            <button
              onClick={handleBlockToggle}
              disabled={blockBusy}
              className={`block w-full border-t-[0.5px] border-[#2c2c2e] px-5 py-4 text-left text-[17px] font-semibold transition-colors active:bg-[#28282a] disabled:opacity-50 ${
                iBlockedThem ? "text-white" : "text-[#e74c3c]"
              }`}
            >
              {blockBusy ? "Working…" : iBlockedThem ? "Unblock User" : "Block User"}
            </button>
            <button
              onClick={() => setShowActions(false)}
              className="block w-full border-t-[0.5px] border-[#2c2c2e] px-5 py-4 text-left text-[17px] text-[#888]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
            router.push("/");
          }}
        />
      )}
    </>
  );
}
