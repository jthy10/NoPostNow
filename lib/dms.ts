"use client";

import { useEffect, useState } from "react";
import {
  db,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from "./store";
import { fetchAllUsers } from "./users";
import { isStandalone } from "./push";
import { useBlockSets } from "./blocks";
import { useAdminChatUnread } from "./admin-chat";
import { apiGet } from "./api";

// Direct messages. One doc per pair of people:
//
//   dms/{threadId}               -> { uids: [a, b], names: {uid: name},
//                                     lastText, lastFrom, lastAt, seenAt: {uid: ts},
//                                     clearedAt: {uid: ts} }
//   dms/{threadId}/messages/{id} -> { from, text, at }
//
// threadId is both uids sorted and joined with "_" — deterministic, so two
// people can never end up with duplicate threads, and the server can
// check membership from the id alone (uids never contain underscores).
//
// Deleting a conversation is per-person: it stamps clearedAt.{uid} rather
// than removing the thread or its messages, both of which are immutable by
// rule. Your list drops the thread and your view hides everything up to that
// stamp; the other side keeps theirs untouched. A later message lands after
// the stamp, so the thread comes back carrying only what was said since.

export type Thread = {
  id: string;
  uids: string[];
  names: Record<string, string>;
  lastText: string;
  lastFrom: string;
  lastAt: Timestamp | null;
  seenAt?: Record<string, Timestamp>;
  clearedAt?: Record<string, Timestamp>;
};

export type Message = {
  id: string;
  from: string;
  text: string;
  at: Timestamp | null;
};

export const MAX_DM_LENGTH = 1000;

export function threadIdFor(uidA: string, uidB: string) {
  return [uidA, uidB].sort().join("_");
}

export function peerUidOf(threadId: string, myUid: string) {
  return threadId.split("_").find((u) => u && u !== myUid) ?? null;
}

// Cleared and still quiet: hide it. The stamp only holds while nothing newer
// has arrived, so a reply from the other side un-hides the thread on its own.
export function isThreadCleared(t: Thread, myUid: string) {
  const cleared = t.clearedAt?.[myUid];
  if (!cleared) return false;
  return !t.lastAt || t.lastAt.toMillis() <= cleared.toMillis();
}

export function isThreadUnread(t: Thread, myUid: string) {
  if (!t.lastAt || t.lastFrom === myUid) return false;
  if (isThreadCleared(t, myUid)) return false;
  const seen = t.seenAt?.[myUid];
  return !seen || t.lastAt.toMillis() > seen.toMillis();
}

// All my threads, live, newest activity first. Sorted client-side so no
// composite index is needed — a friend group has a handful of threads.
export function useThreads(uid: string | undefined) {
  const [threads, setThreads] = useState<Thread[] | null>(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, "dms"), where("uids", "array-contains", uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Thread));
        list.sort((a, b) => (b.lastAt?.toMillis() ?? 0) - (a.lastAt?.toMillis() ?? 0));
        setThreads(list);
      },
      () => setThreads([])
    );
  }, [uid]);

  return threads;
}

// One thread doc, live (null = doesn't exist yet — no messages sent).
export function useThread(threadId: string | undefined) {
  const [thread, setThread] = useState<Thread | null | undefined>(undefined);

  useEffect(() => {
    if (!threadId) return;
    return onSnapshot(
      doc(db, "dms", threadId),
      (snap) => setThread(snap.exists() ? ({ id: snap.id, ...snap.data() } as Thread) : null),
      () => setThread(null)
    );
  }, [threadId]);

  return thread;
}

// Latest messages in a thread, live, oldest-first for rendering. Anything at
// or before `since` was cleared by this user and never renders for them. The
// query still asks for the newest `max`, so clearing a long history cannot
// push live messages out of the window — the cut happens after the fetch.
export function useMessages(
  threadId: string | undefined,
  since?: Timestamp | null,
  max = 200
) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  // Depend on the millis, not the Timestamp: the store hands back a fresh
  // object every snapshot, which would tear down and rebuild the listener
  // on each one.
  const cut = since?.toMillis() ?? null;

  useEffect(() => {
    if (!threadId) return;
    return onSnapshot(
      query(collection(db, "dms", threadId, "messages"), orderBy("at", "desc"), limit(max)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Message))
          // A just-sent message has no server timestamp yet; it is by
          // definition newer than any clear, so it always survives the cut.
          .filter((m) => cut === null || !m.at || m.at.toMillis() > cut);
        // Oldest-first for rendering. A just-sent message has a pending
        // server timestamp (at == null locally) — treat it as newest so it
        // renders at the bottom instead of jumping to the top.
        list.sort(
          (a, b) => (a.at?.toMillis() ?? Infinity) - (b.at?.toMillis() ?? Infinity)
        );
        setMessages(list);
      },
      () => setMessages([])
    );
  }, [threadId, cut, max]);

  return messages;
}

// Send a message: upsert the thread doc (create carries the exact shape the
// rules validate), then append the message. Names are refreshed on every
// send so renamed friends don't stay stale in the list.
export async function sendMessage(opts: {
  myUid: string;
  myName: string;
  peerUid: string;
  peerName: string;
  text: string;
}) {
  const text = opts.text.trim().slice(0, MAX_DM_LENGTH);
  if (!text) return;
  const id = threadIdFor(opts.myUid, opts.peerUid);
  const uids = [opts.myUid, opts.peerUid].sort();

  await setDoc(
    doc(db, "dms", id),
    {
      uids,
      names: { [opts.myUid]: opts.myName, [opts.peerUid]: opts.peerName },
      lastText: text.slice(0, 120),
      lastFrom: opts.myUid,
      lastAt: serverTimestamp(),
      // Sending is reading: your own seen pointer rides along. Nested map
      // (not a dotted path — setDoc doesn't parse those) deep-merges, so the
      // peer's pointer survives.
      seenAt: { [opts.myUid]: serverTimestamp() },
    },
    { merge: true }
  );
  await addDoc(collection(db, "dms", id, "messages"), {
    from: opts.myUid,
    text,
    at: serverTimestamp(),
  });
}

// Mark a thread read (bell-adjacent badge + unread dots clear instantly).
export async function markThreadSeen(threadId: string, myUid: string) {
  try {
    await updateDoc(doc(db, "dms", threadId), {
      [`seenAt.${myUid}`]: serverTimestamp(),
    });
  } catch {
    // Thread doc doesn't exist yet — nothing to mark.
  }
}

// Delete a conversation, for me only. Stamps my own clearedAt pointer; the
// thread doc and every message stay exactly as they were, so the other person
// loses nothing. Marks it seen in the same write — a thread you just deleted
// must not leave an unread badge behind while it is hidden.
export async function clearThread(threadId: string, myUid: string) {
  await updateDoc(doc(db, "dms", threadId), {
    [`clearedAt.${myUid}`]: serverTimestamp(),
    [`seenAt.${myUid}`]: serverTimestamp(),
  });
}

// Count of threads with unread messages — the badge on the chat icon.
// Threads with someone blocked are gone from /dm, so they must not be counted
// here either; a badge that opens onto nothing is both confusing and a tell
// that the blocked person is still messaging. Deleted threads are hidden the
// same way, and isThreadUnread already discounts them. The pinned admins row
// counts as one more thread, for members and for the admin alike.
export function useUnreadThreadCount(uid: string | undefined, admin = false) {
  const threads = useThreads(uid);
  const { hidden } = useBlockSets(uid);
  const adminUnread = useAdminChatUnread(uid, admin);
  if (!uid || !threads) return adminUnread;
  return (
    adminUnread +
    threads.filter((t) => {
      const peer = peerUidOf(t.id, uid);
      return (!peer || !hidden.has(peer)) && isThreadUnread(t, uid);
    }).length
  );
}

// ---- "Who actually has the PWA?" ------------------------------------------
// Union of two signals: users/{email}.appAt (stamped on first standalone
// launch) and owning a push subscription (covers friends who installed
// before appAt existed). Session-cached like the users list.
let appUidsPromise: Promise<Set<string>> | null = null;

export function fetchAppUids(): Promise<Set<string>> {
  appUidsPromise ??= (async () => {
    const uids = new Set<string>();
    const [users, devices] = await Promise.all([
      fetchAllUsers(),
      // Other members' devices are private, so the server answers only with
      // who has one registered.
      apiGet<{ uids: string[] }>("/api/members/app").catch(() => null),
    ]);
    for (const u of users) if (u.uid && u.appAt) uids.add(u.uid);
    for (const uid of devices?.uids ?? []) uids.add(uid);
    return uids;
  })();
  return appUidsPromise;
}

export function useAppUids() {
  const [uids, setUids] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAppUids().then((set) => {
      if (!cancelled) setUids(set);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return uids;
}

// ---- Standalone gate --------------------------------------------------------
// DMs are an app-only feature. isStandalone() touches window, so resolve it
// after mount: null = still deciding (render nothing, avoids a flash).
export function useStandalone() {
  const [standalone, setStandalone] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time environment sniff on mount
    setStandalone(isStandalone());
  }, []);
  return standalone;
}
