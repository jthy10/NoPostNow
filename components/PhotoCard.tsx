"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuthedImage } from "@/lib/use-authed-image";
import {
  toggleLike,
  deletePost,
  assignPost,
  fetchCommentPreview,
  badgeDate,
  isMomentPost,
  isSpecialDayPost,
  updateCaption,
  MAX_CAPTION_LENGTH,
  type CommentPreview,
  type Post,
} from "@/lib/posts";
import { notifyLike } from "@/lib/push";
import { useBlockSets } from "@/lib/blocks";
import { useStreaks } from "@/lib/streaks";
import { createClaim, fetchMyClaimedPostIds, noteClaimed } from "@/lib/claims";
import { useAuth } from "@/lib/auth-context";
import { downloadFile } from "@/lib/files";
import { dailyMomentLabel, specialDateLabel } from "@/lib/site";
import Avatar from "./Avatar";
import StreakFlame from "./StreakFlame";
import AssignPostSheet from "./AssignPostSheet";

// Full date and time, e.g. "TODAY 3:42 PM" / "JUL 4, 3:42 PM" / "JUL 4 2025, 3:42 PM".
// Reads badgeDate() — the same instant the daily-moment badges judge — so the
// caption can never contradict the glow.
function postDateTime(post: Post) {
  const d = badgeDate(post);
  if (!d) return "";
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toUpperCase();

  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dayDiff = (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000;
  if (dayDiff === 0) return `TODAY ${time}`;
  if (dayDiff === 1) return `YESTERDAY ${time}`;

  const date = d
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    })
    .toUpperCase();
  return `${date}, ${time}`;
}

const icon = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const HEART_PATH =
  "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

export default function PhotoCard({
  post,
  uid,
  username = "Someone",
  commentsVersion = 0,
  onOpenComments,
  onDeleted,
  onLikeChange,
}: {
  post: Post;
  uid: string;
  username?: string;
  commentsVersion?: number;
  onOpenComments: (post: Post) => void;
  onDeleted: (id: string) => void;
  // Lets the owning list keep its copy of the post current. Matters where
  // cards unmount and remount (the windowed archive): without it, this
  // component's optimistic like state is lost and the card comes back showing
  // the pre-like count.
  onLikeChange?: (postId: string, likedBy: string[]) => void;
}) {
  const src = useAuthedImage(post.imagePath, true); // compressed display copy
  const { user } = useAuth();
  const [likedBy, setLikedBy] = useState(post.likedBy ?? []);
  const [syncedPost, setSyncedPost] = useState(post);
  // Admin legacy cleanup: an assignment made this session overrides the
  // (stale) post prop until the feed refetches.
  const [assigned, setAssigned] = useState<{ uid: string; username: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  // A non-admin can request ownership of an Anonymous post; once they do we
  // show "Awaiting approval" until an admin resolves it in /admin.
  const [claimed, setClaimed] = useState(false);
  const ownerUid = assigned?.uid ?? post.userUUID;
  const ownerName = assigned?.username ?? post.username;
  const isAnonymousPost = !ownerName || ownerName === "Anonymous";
  const canAssign = user?.isAdmin === true && isAnonymousPost;
  const canClaim = !!user && !user.isAdmin && isAnonymousPost;
  const [downloading, setDownloading] = useState(false);
  // Caption editing (own posts): null = not editing, string = draft text.
  // `caption` overrides the (stale) post prop after a successful save.
  const [caption, setCaption] = useState(post.caption);
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);
  const [captionBusy, setCaptionBusy] = useState(false);
  const [preview, setPreview] = useState<CommentPreview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const likeNotified = useRef(false); // once per mount — toggling spam-pings nobody
  const liked = likedBy.includes(uid);
  // Posts made on the site's daily moment, and every photo from its special
  // date, get the celebratory treatment.
  const specialBadge = isSpecialDayPost(post)
    ? specialDateLabel()
    : isMomentPost(post)
      ? dailyMomentLabel()
      : null;
  const { hidden } = useBlockSets(uid);
  // Days in a row the poster is on, if it's worth a flame. One shared tally
  // serves every card on the page (see lib/streaks).
  const streaks = useStreaks(uid);
  // Blocked users' comments stay out of the preview (shared listener — cheap
  // even with many cards mounted).
  const latestVisible =
    preview?.latest.filter((c) => !c.userUUID || !hidden.has(c.userUUID)) ?? [];
  // ...and their likes stay out of the count, which is the number the Likes
  // tab in the sheet already shows. Leaving it unfiltered made the card read
  // "3" over a list of two names — a blocked person visible by subtraction.
  const visibleLikes = likedBy.filter((u) => !hidden.has(u)).length;

  // Cards never remount across a refetch (same key={post.id} in every list
  // that renders them), so a hard refresh hands this component a brand-new
  // `post` object but likedBy/caption/assigned — seeded from props only once,
  // on mount — would otherwise keep showing whatever was true back then.
  // `post` only changes identity on a genuine refetch (loadMore appends reuse
  // existing references), so resyncing here — during render, not in an effect
  // — catches exactly that case without clobbering an in-flight optimistic
  // like or caption edit, and without the extra render an effect would cost.
  if (post !== syncedPost) {
    setSyncedPost(post);
    setLikedBy(post.likedBy ?? []);
    setCaption(post.caption);
    setAssigned(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetchCommentPreview(post.id)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      // Offline or a denied read — the card just renders without its preview.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [post.id, commentsVersion]);

  // Reflect a claim this member already filed (survives reloads) — one shared
  // query backs every Anonymous card on the page.
  useEffect(() => {
    if (!canClaim || !user?.uid) return;
    let alive = true;
    fetchMyClaimedPostIds(user.uid).then((ids) => {
      if (alive && ids.has(post.id)) setClaimed(true);
    });
    return () => {
      alive = false;
    };
  }, [canClaim, user?.uid, post.id]);

  async function setLike(next: boolean) {
    if (next === liked) return;
    const prev = likedBy;
    const optimistic = next ? [...prev, uid] : prev.filter((id) => id !== uid);
    setLikedBy(optimistic);
    onLikeChange?.(post.id, optimistic);
    try {
      await toggleLike(post.id, uid, liked);
      if (next && ownerUid !== uid && !likeNotified.current) {
        likeNotified.current = true;
        void notifyLike(username, ownerUid, post.id); // fire-and-forget
      }
    } catch {
      setLikedBy(prev);
      onLikeChange?.(post.id, prev);
    }
  }

  // Double-tap the photo to like (never unlike), like the big apps.
  function handleImageTap() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setBurst((b) => b + 1);
      setLike(true);
    }
    lastTap.current = now;
  }

  async function handleDelete() {
    if (!confirm("Delete this post?")) return;
    await deletePost(post.id);
    onDeleted(post.id);
  }

  async function saveCaption() {
    if (captionDraft === null || captionBusy) return;
    const next = captionDraft.trim().slice(0, MAX_CAPTION_LENGTH);
    if (next === caption) {
      setCaptionDraft(null);
      return;
    }
    setCaptionBusy(true);
    try {
      await updateCaption(post.id, next);
      setCaption(next);
      setCaptionDraft(null);
    } catch {
      alert("Couldn't save the caption — please try again.");
    } finally {
      setCaptionBusy(false);
    }
  }

  // Admin legacy cleanup: link an Anonymous post to its real poster. The
  // freshAdmin() rule gates the write server-side, so it only succeeds within
  // 15 minutes of unlocking /admin.
  async function handleAssign(u: { uid: string; username: string }) {
    if (!confirm(`Assign this post to ${u.username}?`)) return;
    setAssignOpen(false);
    try {
      await assignPost(post.id, u.uid, u.username);
      setAssigned(u);
    } catch {
      alert(
        "Couldn't assign — unlock the admin panel first (re-enter your password on /admin), then try again."
      );
    }
  }

  // Member-initiated: ask to be credited as this Anonymous post's owner. The
  // request lands in the admin Approvals queue; nothing changes until approved.
  async function handleClaim() {
    if (!user?.uid || !user.email) return;
    if (!confirm("Are you sure you posted this photo?")) return;
    try {
      await createClaim({ postId: post.id, uid: user.uid, username });
      noteClaimed(user.uid, post.id);
      setClaimed(true);
    } catch {
      alert("Couldn't submit your claim — please try again.");
    }
  }

  // Always fetches the untouched original, never the compressed feed copy.
  // iOS PWAs can't do classic file downloads, so there the share sheet is
  // the download: it offers Save Image straight to the camera roll.
  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await downloadFile(post.imagePath);
      const name = post.imagePath.split("/").pop() || "photo.jpg";
      const file = new File([blob], name, { type: blob.type || "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch {
      // user closed the share sheet, or fetch failed — nothing to clean up
    }
    setDownloading(false);
  }

  return (
    <article className="border-b-[0.5px] border-field px-2.5 pt-2.5">
      <div
        className={`relative rounded-lg ${
          specialBadge
            ? // TopNav/PageHeader are fixed, opaque, and sized to exactly
              // match the scroll container's top padding, so a card with
              // nothing above it (every permalink from a notification) has
              // its box-shadow glow bleed straight into the header's
              // territory. Rather than push the card down to dodge it, let
              // the glow spill over the header itself — above the nav
              // (z-40) but below the notch/status-bar backing (z-50), which
              // has to stay opaque for the clock/battery to stay readable.
              "z-[45] animate-[seven-glow_3s_ease-in-out_infinite]"
            : ""
        }`}
        onPointerUp={handleImageTap}
      >
        {specialBadge && (
          <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-[#ffd88a] ring-1 ring-[#ffd88a]/40 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-[#ffd88a]" aria-hidden>
              <path d="M12 2l2.35 5.76L20.5 8.3l-4.7 4.02 1.5 6.18L12 15.6 6.7 18.5l1.5-6.18L3.5 8.3l6.15-.54z" />
            </svg>
            {specialBadge}
          </div>
        )}
        {/* Dimensions from the doc reserve exact space before bytes arrive
            (no layout shift) and let tall photos show uncropped. */}
        {post.imageWidth && post.imageHeight ? (
          <div
            className="max-h-[80vh] w-full overflow-hidden rounded-lg bg-card"
            style={{ aspectRatio: `${post.imageWidth} / ${post.imageHeight}` }}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={post.caption || "photo"}
                onLoad={() => setLoaded(true)}
                className={`h-full w-full object-contain transition-opacity duration-300 ${
                  loaded ? "opacity-100" : "opacity-0"
                }`}
              />
            ) : (
              <div className="h-full w-full animate-pulse bg-card" />
            )}
          </div>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={post.caption || "photo"}
            onLoad={() => setLoaded(true)}
            className={`max-h-[80vh] w-full rounded-lg object-cover transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : (
          <div className="aspect-square w-full animate-pulse rounded-lg bg-card" />
        )}
        {burst > 0 && (
          <svg
            key={burst}
            viewBox="0 0 24 24"
            className="pointer-events-none absolute inset-0 m-auto h-24 w-24 animate-[heart-burst_0.8s_ease-out_forwards] fill-white drop-shadow-lg"
          >
            <path d={HEART_PATH} />
          </svg>
        )}
      </div>

      {/* The name gives way before the meta does: a long username ellipsizes
          rather than shoving the date into a second line (or, on a narrow
          phone, straight underneath itself). */}
      <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-2.5">
        {/* Legacy PHP-era posts have no userUUID, so there's no profile to open. */}
        {ownerUid ? (
          <Link
            href={ownerUid === uid ? "/profile" : `/u/${ownerUid}`}
            className="flex min-w-0 items-center gap-2"
          >
            <Avatar username={ownerName} className="h-7 w-7 text-[10px]" />
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold">
              <span className="truncate">{ownerName || "Anonymous"}</span>
              <StreakFlame days={streaks.get(ownerUid) ?? 0} />
            </span>
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar username={ownerName} className="h-7 w-7 text-[10px]" />
            <span className="truncate text-[13px] font-bold">{ownerName || "Anonymous"}</span>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-3">
          {canAssign && (
            <button
              onClick={() => setAssignOpen(true)}
              aria-label="Assign post to a member"
              className="text-dim transition-colors hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" {...icon}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          )}
          {canClaim &&
            (claimed ? (
              <span className="rounded-full border-[0.5px] border-edge px-2 py-0.5 text-[10px] font-bold uppercase tracking-[1px] text-meta">
                Awaiting approval
              </span>
            ) : (
              <button
                onClick={handleClaim}
                aria-label="Claim this post as yours"
                className="rounded-full border-[0.5px] border-edge px-2 py-0.5 text-[10px] font-bold uppercase tracking-[1px] text-mut transition-colors hover:border-mut hover:text-white"
              >
                Claim post
              </button>
            ))}
          <span className="text-[11px] font-medium text-meta">{postDateTime(post)}</span>
          <button
            onClick={handleDownload}
            aria-label="Download original photo"
            className={`text-dim transition-colors hover:text-white ${
              downloading ? "animate-pulse text-mut" : ""
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" {...icon}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          {post.userUUID === uid && (
            <>
              <button
                onClick={() => setCaptionDraft((d) => (d === null ? caption : null))}
                aria-label={caption ? "Edit caption" : "Add caption"}
                className={`transition-colors hover:text-white ${
                  captionDraft !== null ? "text-white" : "text-dim"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" {...icon}>
                  <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                </svg>
              </button>
              <button
                onClick={handleDelete}
                aria-label="Delete post"
                className="text-dim transition-colors hover:text-red-500"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" {...icon}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {captionDraft !== null ? (
        <div className="flex items-center gap-2 px-1 pt-0.5">
          {/* 16px font — anything smaller makes iOS zoom the page on focus. */}
          <input
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCaption();
              if (e.key === "Escape") setCaptionDraft(null);
            }}
            maxLength={MAX_CAPTION_LENGTH}
            placeholder="Write a caption…"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border-[0.5px] border-edge bg-field px-3 py-2 text-[16px] outline-none placeholder:text-dim focus:border-mut"
          />
          <button
            onClick={saveCaption}
            disabled={captionBusy}
            className="shrink-0 rounded-lg bg-white px-3.5 py-2 text-xs font-extrabold text-black transition-opacity disabled:opacity-40"
          >
            {captionBusy ? "…" : "Save"}
          </button>
        </div>
      ) : (
        caption && (
          <p className="break-words px-1 pt-0.5 text-sm leading-[1.45] text-body">{caption}</p>
        )
      )}

      <div className="flex items-center px-1 pb-3 pt-1.5">
        <button
          onClick={() => setLike(!liked)}
          className="flex items-center gap-1.5 p-1 transition-transform active:scale-90"
          aria-label={liked ? "Unlike" : "Like"}
        >
          <svg
            key={liked ? "on" : "off"}
            viewBox="0 0 24 24"
            className={`h-[22px] w-[22px] ${
              liked
                ? "animate-[heart-pop_0.3s_ease-out] fill-heart text-heart"
                : "fill-none text-mut"
            }`}
            {...icon}
          >
            <path d={HEART_PATH} />
          </svg>
          <span className={`text-[13px] font-bold ${liked ? "text-heart" : "text-mut"}`}>
            {visibleLikes}
          </span>
        </button>

        <button
          onClick={() => onOpenComments(post)}
          className="ml-2 flex items-center gap-1.5 p-1 text-mut"
          aria-label="Comments"
        >
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" {...icon}>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span className="text-[13px] font-bold">{preview?.count ?? ""}</span>
        </button>
      </div>

      {preview && preview.count > 0 && latestVisible.length > 0 && (
        <div className="flex flex-col gap-1.5 px-1 pb-3">
          {latestVisible.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar username={c.username} className="mt-0.5 h-5 w-5 text-[7px]" />
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-[#999]">
                {c.userUUID ? (
                  <Link
                    href={c.userUUID === uid ? "/profile" : `/u/${c.userUUID}`}
                    className="font-bold text-white"
                  >
                    {c.username}
                  </Link>
                ) : (
                  <span className="font-bold text-white">{c.username}</span>
                )}{" "}
                <span className="break-words">{c.text}</span>
              </p>
            </div>
          ))}
          {preview.count > latestVisible.length && (
            <button
              onClick={() => onOpenComments(post)}
              className="self-start pl-7 text-[11px] font-semibold text-mut transition-colors hover:text-[#888]"
            >
              View all {preview.count} comments
            </button>
          )}
        </div>
      )}

      {assignOpen && (
        <AssignPostSheet onSelect={handleAssign} onClose={() => setAssignOpen(false)} />
      )}
    </article>
  );
}
