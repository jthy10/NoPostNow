"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  fetchComments,
  addComment,
  deleteComment,
  toggleCommentLike,
  fetchPostLikers,
  type Comment,
  type Post,
} from "@/lib/posts";
import {
  useKeyboardInset,
  useBodyScrollLock,
  useSwipeDismiss,
  useEscapeToClose,
} from "@/lib/sheet";
import { notifyComment, notifyMention, notifyCommentLike } from "@/lib/push";
import { useBlockSets } from "@/lib/blocks";
import { useStreaks } from "@/lib/streaks";
import { useMentionUsers, type MentionCandidate } from "@/lib/users";
import {
  activeMentionQuery,
  insertMention,
  extractMentionUids,
  splitMentions,
} from "@/lib/mentions";
import Avatar from "./Avatar";
import StreakFlame from "./StreakFlame";

const MAX_COMMENT_LENGTH = 200;

function commentTime(ts: Comment["timestamp"]) {
  if (!ts) return "";
  const d = ts.toDate();
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function CommentSheet({
  post,
  uid,
  username,
  onClose,
  onChanged,
}: {
  post: Post;
  uid: string;
  username: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [allComments, setAllComments] = useState<Comment[] | null>(null);
  const { hidden } = useBlockSets(uid);
  // Blocked either way — their comments (and likes) don't render.
  const comments =
    allComments?.filter((c) => !c.userUUID || !hidden.has(c.userUUID)) ?? null;
  // Days in a row each commenter is on — one tally for the whole thread.
  const streaks = useStreaks(uid);
  const [tab, setTab] = useState<"comments" | "likes">("comments");
  const [likerUids, setLikerUids] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Comment-likes only ping the author once per open thread, however much the
  // like is toggled — same "no spam-ping" rule as photo likes.
  const likeNotified = useRef<Set<string>>(new Set());
  const { inset, visibleHeight } = useKeyboardInset();
  useBodyScrollLock();
  const { sheetRef, dragY, dragging } = useSwipeDismiss(requestClose, {
    scrollRef: listRef,
  });
  useEscapeToClose(requestClose);

  // Everyone selectable with @, most recently active first. Includes the
  // signed-in user (so their own name still highlights when mentioned); the
  // picker filters them and blocked users out below. Also backs name/avatar
  // resolution for mention links and the Likes list.
  const mentionUsers = useMentionUsers();
  const userByUid = useMemo(
    () => new Map(mentionUsers.map((u) => [u.uid, u])),
    [mentionUsers]
  );

  // Where a person (mention target / liker) links to — their own profile page
  // for the signed-in user, the public /u page for anyone else.
  const profileHref = (personUid: string) =>
    personUid === uid ? "/profile" : `/u/${personUid}`;

  // Likes tab, filtered through blocks and resolved for display order.
  const likers = useMemo(
    () => likerUids?.filter((u) => !hidden.has(u)) ?? null,
    [likerUids, hidden]
  );
  const likeCount = (likerUids ?? post.likedBy ?? []).filter(
    (u) => !hidden.has(u)
  ).length;

  // Which "@token" the caret is in (if any) and the matching, un-blocked,
  // non-self candidates for the picker.
  const mention = useMemo(() => activeMentionQuery(text, caret), [text, caret]);
  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return mentionUsers
      .filter((u) => u.uid !== uid && !hidden.has(u.uid))
      .filter((u) => !q || u.username.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, mentionUsers, uid, hidden]);
  const mentionOpen = tab === "comments" && Boolean(mention) && mentionMatches.length > 0;

  function scrollToLatest(smooth = false) {
    requestAnimationFrame(() => {
      const el = listRef.current;
      el?.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  async function load() {
    setAllComments(await fetchComments(post.id));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial comment fetch on mount
    load()
      .then(() => scrollToLatest())
      .catch(() => setAllComments((prev) => prev ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  // Load who liked the post the first time the Likes tab is opened — fresh from
  // the doc so it reflects likes added after the sheet was opened.
  useEffect(() => {
    if (tab !== "likes" || likerUids !== null) return;
    let cancelled = false;
    fetchPostLikers(post.id).then((uids) => {
      if (!cancelled) setLikerUids(uids);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, likerUids, post.id]);

  function requestClose() {
    setClosing(true);
    setTimeout(onClose, 250);
  }

  // Drop the picked name in as "@Name " and keep the caret after it.
  function pickMention(u: MentionCandidate) {
    if (!mention) return;
    const next = insertMention(text, caret, mention.start, u.username);
    const capped = next.text.slice(0, MAX_COMMENT_LENGTH);
    const pos = Math.min(next.caret, capped.length);
    setText(capped);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
      setCaret(pos);
    });
  }

  // Reply: pre-fill the composer with "@Author " and drop the cursor after it,
  // ready to type. Tags with the author's *live* name (resolved from their uid)
  // so the @ still lands even if the comment stored a pre-rename username.
  function handleReply(c: Comment) {
    const liveName = (c.userUUID && userByUid.get(c.userUUID)?.username) || c.username;
    const tag = `@${liveName} `.slice(0, MAX_COMMENT_LENGTH);
    setTab("comments");
    setText(tag);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(tag.length, tag.length);
      }
      setCaret(tag.length);
    });
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setSendError(null);
    try {
      await addComment(post.id, uid, username, trimmed);
    } catch {
      // Keep what they typed — retrying is one tap, and swallowing this made a
      // failed comment look like a sent one.
      setSendError("Couldn't post that — check your connection and try again.");
      setBusy(false);
      return;
    }

    // Posted. Everything from here is best-effort follow-up; none of it should
    // be able to report the comment as failed.
    //
    // Split the fan-out. @mentioned members get the richer "mentioned you"
    // ping; the usual thread (poster + everyone who already commented) gets
    // the generic "commented" one — minus anyone already mentioned, so a
    // named person is never pinged twice for the same comment. `comments` is
    // the pre-send, block-filtered list, so blocked users are excluded.
    const mentionTargets = extractMentionUids(trimmed, mentionUsers).filter((u) => u !== uid);
    const mentionSet = new Set(mentionTargets);
    const participantUids = (comments ?? [])
      .map((c) => c.userUUID)
      .filter((u): u is string => Boolean(u))
      .filter((u) => !mentionSet.has(u));
    const ownerForComment = mentionSet.has(post.userUUID) ? "" : post.userUUID;
    if (mentionTargets.length) void notifyMention(username, trimmed, mentionTargets, post.id);
    void notifyComment(username, trimmed, ownerForComment, post.id, participantUids);
    setText("");
    setCaret(0);
    await load().catch(() => {});
    scrollToLatest(true);
    onChanged?.();
    setBusy(false);
  }

  async function handleToggleCommentLike(c: Comment) {
    const likes = c.likedBy ?? [];
    const liked = likes.includes(uid);
    const next = liked ? likes.filter((x) => x !== uid) : [...likes, uid];
    // Optimistic — flip the heart now, reconcile (or roll back) after the write.
    setAllComments((prev) =>
      prev?.map((x) => (x.id === c.id ? { ...x, likedBy: next } : x)) ?? prev
    );
    try {
      await toggleCommentLike(post.id, c.id, uid, liked);
      if (!liked && c.userUUID && c.userUUID !== uid && !likeNotified.current.has(c.id)) {
        likeNotified.current.add(c.id);
        void notifyCommentLike(username, c.userUUID, post.id);
      }
    } catch {
      setAllComments((prev) =>
        prev?.map((x) => (x.id === c.id ? { ...x, likedBy: likes } : x)) ?? prev
      );
    }
  }

  async function handleDelete(commentId: string) {
    if (!confirm("Delete this comment?")) return;
    setSendError(null);
    try {
      await deleteComment(post.id, commentId);
    } catch {
      setSendError("Couldn't delete that — try again.");
      return;
    }
    await load().catch(() => {});
    onChanged?.();
  }

  // Highlight @mentions inline and link each to that member's profile.
  function renderBody(body: string) {
    return splitMentions(body, mentionUsers).map((seg, i) =>
      seg.mention ? (
        <Link
          key={i}
          href={profileHref(seg.mention.uid)}
          className="font-semibold text-mention hover:underline"
        >
          {seg.text}
        </Link>
      ) : (
        <span key={i}>{seg.text}</span>
      )
    );
  }

  const tabClass = (active: boolean) =>
    `text-sm font-extrabold transition-colors ${active ? "text-white" : "text-mut hover:text-body"}`;

  return (
    <div
      // paddingBottom lifts the sheet above the iOS keyboard (see useKeyboardInset).
      // Backdrop dims out as the sheet is dragged down.
      className={`fixed inset-0 z-50 flex items-end bg-black/70 transition-[opacity,padding] duration-250 ${
        closing ? "opacity-0" : "animate-[fade-in_0.25s_ease-out]"
      }`}
      style={{
        paddingBottom: inset,
        backgroundColor:
          !closing && dragY > 0
            ? `rgba(0,0,0,${(0.7 * Math.max(0, 1 - dragY / 500)).toFixed(3)})`
            : undefined,
      }}
      onClick={requestClose}
    >
      <div
        ref={sheetRef}
        className={`flex max-h-[75vh] w-full flex-col rounded-t-2xl border-t-[0.5px] border-[#222] bg-card transition-transform duration-250 ${
          closing ? "translate-y-full" : "animate-[sheet-up_0.3s_ease-out]"
        }`}
        style={{
          ...(inset > 0 && visibleHeight > 0 ? { maxHeight: visibleHeight - 24 } : undefined),
          // Follow the finger while dragging; transition off so it tracks 1:1.
          transform: !closing && dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-[#333]" />

        <div className="flex shrink-0 items-center justify-between border-b-[0.5px] border-line px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-4">
            <button onClick={() => setTab("comments")} className={tabClass(tab === "comments")}>
              {comments === null
                ? "Comments"
                : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
            </button>
            <button onClick={() => setTab("likes")} className={tabClass(tab === "likes")}>
              {`${likeCount} like${likeCount === 1 ? "" : "s"}`}
            </button>
          </div>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="px-0.5 text-[22px] leading-none text-mut transition-colors hover:text-white"
          >
            ×
          </button>
        </div>

        <div
          ref={listRef}
          className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3"
        >
          {tab === "comments" ? (
            <>
              {comments === null && (
                <p className="py-6 text-center text-[13px] text-dim">Loading…</p>
              )}
              {comments?.length === 0 && (
                <p className="py-6 text-center text-[13px] text-dim">
                  No comments yet. Be the first!
                </p>
              )}
              {comments?.map((c) => {
                const likeCt = c.likedBy?.length ?? 0;
                const likedByMe = c.likedBy?.includes(uid) ?? false;
                return (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <Avatar username={c.username} className="h-[30px] w-[30px] text-[10px]" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-xs font-bold">
                        {c.userUUID ? (
                          <Link href={profileHref(c.userUUID)} className="truncate">
                            {c.username}
                          </Link>
                        ) : (
                          <span className="truncate">{c.username}</span>
                        )}
                        {c.userUUID && <StreakFlame days={streaks.get(c.userUUID) ?? 0} />}
                      </div>
                      <p className="break-words text-sm leading-[1.45] text-body">
                        {renderBody(c.text)}
                      </p>
                      <div className="mt-1 flex items-center gap-3">
                        <span className="text-[11px] text-meta">{commentTime(c.timestamp)}</span>
                        <button
                          onClick={() => handleReply(c)}
                          className="text-[11px] font-semibold text-mut transition-colors hover:text-white"
                        >
                          Reply
                        </button>
                        {c.userUUID === uid && (
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="text-[11px] font-semibold text-mut transition-colors hover:text-red-500"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Like a comment — heart on the right, IG-style, with its count. */}
                    <button
                      onClick={() => handleToggleCommentLike(c)}
                      aria-label={likedByMe ? "Unlike comment" : "Like comment"}
                      className="flex shrink-0 flex-col items-center gap-0.5 pt-1 transition-transform active:scale-90"
                    >
                      <svg
                        key={likedByMe ? "on" : "off"}
                        viewBox="0 0 24 24"
                        className={`h-[15px] w-[15px] ${
                          likedByMe
                            ? "animate-[heart-pop_0.3s_ease-out] fill-heart text-heart"
                            : "fill-none text-mut"
                        }`}
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      {likeCt > 0 && (
                        <span
                          className={`text-[10px] font-bold leading-none ${
                            likedByMe ? "text-heart" : "text-meta"
                          }`}
                        >
                          {likeCt}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="flex flex-col">
              {likers === null && (
                <p className="py-6 text-center text-[13px] text-dim">Loading…</p>
              )}
              {likers?.length === 0 && (
                <p className="py-6 text-center text-[13px] text-dim">No likes yet.</p>
              )}
              {likers?.map((personUid) => {
                const name = userByUid.get(personUid)?.username ?? "Someone";
                return (
                  <Link
                    key={personUid}
                    href={profileHref(personUid)}
                    className="flex items-center gap-3 py-2 transition-opacity active:opacity-60"
                  >
                    <Avatar username={name} className="h-9 w-9 text-xs" />
                    <span className="text-sm font-semibold">{name}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {tab === "comments" && (
          <div className="relative shrink-0 border-t-[0.5px] border-line px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2.5">
            {/* @-picker floats above the composer; onMouseDown-preventDefault keeps
                the input focused (and its caret alive) through the tap. */}
            {mentionOpen && (
              <div className="absolute inset-x-0 bottom-full max-h-56 overflow-y-auto overscroll-contain border-t-[0.5px] border-line bg-card">
                {mentionMatches.map((u) => (
                  <button
                    key={u.uid}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickMention(u)}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-field active:bg-field"
                  >
                    <Avatar username={u.username} className="h-7 w-7 text-[9px]" />
                    <span className="text-[13px] font-semibold">{u.username}</span>
                  </button>
                ))}
              </div>
            )}
            {sendError && (
              <p className="pb-2 text-center text-[11px] text-heart">{sendError}</p>
            )}
            <div className="flex items-center gap-2.5">
              {/* 16px font — anything smaller makes iOS zoom the page on focus.
                  No autoFocus: opening comments should show comments, not the keyboard. */}
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                }}
                onKeyUp={() => setCaret(inputRef.current?.selectionStart ?? 0)}
                onClick={() => setCaret(inputRef.current?.selectionStart ?? 0)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  // While the picker is up, Enter takes the top match instead of
                  // sending — so you can @someone without the comment firing early.
                  if (mentionOpen) {
                    e.preventDefault();
                    pickMention(mentionMatches[0]);
                  } else {
                    handleSend();
                  }
                }}
                placeholder="Add a comment…  @ to mention"
                maxLength={MAX_COMMENT_LENGTH}
                enterKeyHint="send"
                className="min-w-0 flex-1 rounded-full border-[0.5px] border-edge bg-field px-4 py-2.5 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-mut"
              />
              <button
                onClick={handleSend}
                disabled={busy || !text.trim()}
                aria-label="Send comment"
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white text-black transition-opacity disabled:opacity-40"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
