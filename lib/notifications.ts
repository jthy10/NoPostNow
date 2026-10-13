"use client";

import { useEffect, useState } from "react";
import {
  db,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from "./store";
import { fetchMessageableUsers } from "./users";
import { fetchHiddenUids, useBlockSets } from "./blocks";

// Per-user in-app notification feed backing the bell in the top bar and the
// /notifications page. Every item deep-links to its post via /p/{postId}.
//
//   notifications/{uid}            -> { seenAt }   (last time they opened the page)
//   notifications/{uid}/items/{id} -> { type, actorUid, actorName, postId, text?, at }
//
// Items are written by the acting client right after the action succeeds —
// same trust model as posts/comments themselves, enforced by the server
// (actorUid/actorName must be your own, no writing into your own feed).
// DMs deliberately never appear here; they get push + the /dm badge instead.

export type NotificationItem = {
  id: string;
  // mention: someone @mentioned you in a comment (carries the comment text).
  // commentLike: someone liked a comment you wrote (no text — "liked your
  // comment"). Both deep-link to the post's open comment thread.
  type: "post" | "comment" | "like" | "mention" | "commentLike";
  actorUid: string;
  actorName: string;
  postId: string;
  text?: string;
  at: Timestamp | null;
};

// How far back the bell counts. Anything past this shows as "99+" anyway.
const BADGE_SCAN = 100;

function itemsCol(uid: string) {
  return collection(db, "notifications", uid, "items");
}

async function writeItem(
  targetUid: string,
  item: Omit<NotificationItem, "id" | "at">
) {
  await addDoc(itemsCol(targetUid), { ...item, at: serverTimestamp() });
}

// "X just posted" lands in everyone's feed. Fire-and-forget from the caller;
// one friend's feed failing must not block the others (allSettled).
export async function recordPostNotification(
  actorUid: string,
  actorName: string,
  postId: string,
  caption: string
) {
  // Merged list: includes friends whose users doc never self-healed a uid.
  // This is the only fan-out that targets *everyone*, so it's the only one
  // that has to subtract blocks itself — every other record* function is
  // handed a recipient list its caller already filtered.
  //
  // If the block lists can't be read, fall back to notifying everyone: the
  // reader's own client filters both the list and the badge by the same
  // union, so an item that shouldn't be there stays invisible either way.
  const [users, hidden] = await Promise.all([
    fetchMessageableUsers(),
    fetchHiddenUids(actorUid).catch(() => new Set<string>()),
  ]);
  const targets = new Set(
    users
      .map((u) => u.uid)
      .filter((uid): uid is string => !!uid && uid !== actorUid && !hidden.has(uid))
  );
  await Promise.allSettled(
    [...targets].map((uid) =>
      writeItem(uid, {
        type: "post",
        actorUid,
        actorName,
        postId,
        ...(caption ? { text: caption.slice(0, 200) } : {}),
      })
    )
  );
}

// A comment notifies the whole thread: the post owner plus everyone else who
// already commented, so people can follow the back-and-forth. Callers pass the
// full recipient list; we dedupe and drop the actor (never notify yourself).
export async function recordCommentNotification(
  actorUid: string,
  actorName: string,
  postId: string,
  text: string,
  targetUids: string[]
) {
  const targets = new Set(targetUids.filter((uid) => uid && uid !== actorUid));
  await Promise.allSettled(
    [...targets].map((uid) =>
      writeItem(uid, {
        type: "comment",
        actorUid,
        actorName,
        postId,
        text: text.slice(0, 200),
      })
    )
  );
}

export async function recordLikeNotification(
  actorUid: string,
  actorName: string,
  postId: string,
  ownerUid: string
) {
  if (!ownerUid || ownerUid === actorUid) return;
  await writeItem(ownerUid, { type: "like", actorUid, actorName, postId });
}

// "X mentioned you" → just the people named with @ in the comment. Dedupe and
// drop the actor (you can @ yourself; you're never notified for it).
export async function recordMentionNotification(
  actorUid: string,
  actorName: string,
  postId: string,
  text: string,
  targetUids: string[]
) {
  const targets = new Set(targetUids.filter((uid) => uid && uid !== actorUid));
  await Promise.allSettled(
    [...targets].map((uid) =>
      writeItem(uid, {
        type: "mention",
        actorUid,
        actorName,
        postId,
        text: text.slice(0, 200),
      })
    )
  );
}

// "X liked your comment" → the comment's author only.
export async function recordCommentLikeNotification(
  actorUid: string,
  actorName: string,
  postId: string,
  authorUid: string
) {
  if (!authorUid || authorUid === actorUid) return;
  await writeItem(authorUid, { type: "commentLike", actorUid, actorName, postId });
}

export async function markNotificationsSeen(uid: string) {
  await setDoc(doc(db, "notifications", uid), { seenAt: serverTimestamp() }, { merge: true });
}

export async function getNotificationsSeenAt(uid: string): Promise<Timestamp | null> {
  const snap = await getDoc(doc(db, "notifications", uid));
  return snap.exists() ? (snap.data().seenAt as Timestamp | undefined) ?? null : null;
}

// Live list for the /notifications page.
export function useNotifications(uid: string | undefined, max: number) {
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(itemsCol(uid), orderBy("at", "desc"), limit(max)),
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as NotificationItem)));
      },
      () => setItems([]) // rules denial / offline — show empty instead of spinning
    );
  }, [uid, max]);

  return items;
}

// Live unseen count for the bell badge: items newer than seenAt.
// Two light listeners (seen doc + newest items) so the badge updates the
// moment a friend likes/comments/posts, on every page the top bar is on.
//
// Rows carry their actor so the count can drop the same people /notifications
// hides. Without that the badge counts a blocked friend's activity and then
// the page it opens shows nothing — and worse, it announces that someone you
// made invisible is still around. Filtering on read (not just on write) also
// covers items already in the feed when the block happened.
export function useUnseenNotifications(uid: string | undefined) {
  const [seenAt, setSeenAt] = useState<Timestamp | null>(null);
  const [seenLoaded, setSeenLoaded] = useState(false);
  const [rows, setRows] = useState<{ at: Timestamp; actorUid: string }[]>([]);
  const { hidden } = useBlockSets(uid);

  useEffect(() => {
    if (!uid) return;
    const stopSeen = onSnapshot(
      doc(db, "notifications", uid),
      (snap) => {
        setSeenAt(snap.exists() ? (snap.data().seenAt as Timestamp | undefined) ?? null : null);
        setSeenLoaded(true);
      },
      () => setSeenLoaded(true)
    );
    const stopItems = onSnapshot(
      query(itemsCol(uid), orderBy("at", "desc"), limit(BADGE_SCAN)),
      (snap) => {
        setRows(
          snap.docs
            .map((d) => ({
              at: d.data().at as Timestamp | null,
              actorUid: (d.data().actorUid as string | undefined) ?? "",
            }))
            .filter((r): r is { at: Timestamp; actorUid: string } => Boolean(r.at))
        );
      },
      () => setRows([])
    );
    return () => {
      stopSeen();
      stopItems();
    };
  }, [uid]);

  if (!uid || !seenLoaded) return 0;
  const visible = rows.filter((r) => !hidden.has(r.actorUid));
  if (!seenAt) return visible.length;
  return visible.filter((r) => r.at.toMillis() > seenAt.toMillis()).length;
}

// Compact relative time for notification rows and DM previews.
export function timeAgo(ts: Timestamp | null) {
  if (!ts) return "";
  const d = ts.toDate();
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
