"use client";

import { useEffect, useState } from "react";
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  arrayUnion,
  arrayRemove,
} from "./store";
import { invalidateFeedCache } from "./feed-cache";

// Blocking is mutual invisibility: neither side sees the other's posts,
// profile, comments, notifications, DMs, or search rows.
//
//   blocks/{uid} -> { blocked: [uid, ...] }
//
// Both directions matter, so the store watches your own list AND every list
// containing you (array-contains query — rules let any member read blocks,
// which is required for that query and is fine for a friend group).
//
// One shared subscription serves every mounted useBlockSets() — PhotoCard
// alone renders many times per page, so per-mount listeners would multiply.

export type BlockSets = {
  blocked: Set<string>; // people I blocked
  blockedBy: Set<string>; // people who blocked me
  hidden: Set<string>; // union — hide these uids everywhere
  // Both listeners have reported in (an error counts). Views that would
  // otherwise flash a blocked person's content before the lists land — a
  // permalink opened straight from a link — wait on this instead.
  ready: boolean;
};

const EMPTY: BlockSets = {
  blocked: new Set(),
  blockedBy: new Set(),
  hidden: new Set(),
  ready: false,
};

let current: BlockSets = EMPTY;
let activeUid: string | null = null;
let stopListeners: (() => void) | null = null;
const subscribers = new Set<(s: BlockSets) => void>();

// Per-listener state. "ok" means we hold the real list; "error" means rules
// or the network said no and we're falling back to empty. Only "ok" on both
// halves makes the cached sets safe to answer a one-shot read from.
type Status = "pending" | "ok" | "error";
let mineStatus: Status = "pending";
let theirsStatus: Status = "pending";

function publish(blocked: Set<string>, blockedBy: Set<string>) {
  current = {
    blocked,
    blockedBy,
    hidden: new Set([...blocked, ...blockedBy]),
    ready: mineStatus !== "pending" && theirsStatus !== "pending",
  };
  subscribers.forEach((fn) => fn(current));
}

function ensureListeners(uid: string) {
  if (activeUid === uid) return;
  stopListeners?.();
  activeUid = uid;
  current = EMPTY;
  mineStatus = "pending";
  theirsStatus = "pending";

  let blocked = new Set<string>();
  let blockedBy = new Set<string>();

  const stopMine = onSnapshot(
    doc(db, "blocks", uid),
    (snap) => {
      const list = snap.exists() ? (snap.data().blocked as string[] | undefined) ?? [] : [];
      blocked = new Set(list.filter((x) => typeof x === "string"));
      mineStatus = "ok";
      publish(blocked, blockedBy);
    },
    () => {
      mineStatus = "error";
      publish((blocked = new Set()), blockedBy);
    }
  );
  const stopTheirs = onSnapshot(
    query(collection(db, "blocks"), where("blocked", "array-contains", uid)),
    (snap) => {
      blockedBy = new Set(snap.docs.map((d) => d.id));
      theirsStatus = "ok";
      publish(blocked, blockedBy);
    },
    () => {
      theirsStatus = "error";
      publish(blocked, (blockedBy = new Set()));
    }
  );
  stopListeners = () => {
    stopMine();
    stopTheirs();
    stopListeners = null;
    activeUid = null;
    mineStatus = "pending";
    theirsStatus = "pending";
  };
}

// Live block state for the signed-in user. Starts as the empty set so pages
// render immediately and tighten up the moment the listeners land. The
// shared listeners stay alive for the session (a friend group's block lists
// are two tiny reads) and re-target if a different account signs in.
export function useBlockSets(uid: string | undefined): BlockSets {
  const [sets, setSets] = useState<BlockSets>(() =>
    uid && uid === activeUid ? current : EMPTY
  );

  useEffect(() => {
    if (!uid) return;
    ensureListeners(uid);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the shared store on (re)subscribe
    setSets(current);
    const fn = (s: BlockSets) => setSets(s);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, [uid]);

  return sets;
}

// The same union, for write paths that run outside React — the bell fan-out
// decides who to notify before any of this is on screen. Answers from the
// live store only when both listeners actually delivered; a store that is
// still pending (or errored to empty) would hand back "nobody is hidden",
// which is exactly the wrong answer to fan out on. Throws if the one-shot
// read fails — callers decide what an unknown answer means for them.
export async function fetchHiddenUids(uid: string): Promise<Set<string>> {
  if (activeUid === uid && mineStatus === "ok" && theirsStatus === "ok") {
    return current.hidden;
  }
  const [mine, theirs] = await Promise.all([
    getDoc(doc(db, "blocks", uid)),
    getDocs(query(collection(db, "blocks"), where("blocked", "array-contains", uid))),
  ]);
  const list = mine.exists() ? (mine.data().blocked as string[] | undefined) ?? [] : [];
  return new Set([
    ...list.filter((x): x is string => typeof x === "string"),
    ...theirs.docs.map((d) => d.id),
  ]);
}

export async function blockUser(myUid: string, targetUid: string) {
  await setDoc(doc(db, "blocks", myUid), { blocked: arrayUnion(targetUid) }, { merge: true });
  invalidateFeedCache();
}

export async function unblockUser(myUid: string, targetUid: string) {
  await setDoc(doc(db, "blocks", myUid), { blocked: arrayRemove(targetUid) }, { merge: true });
  invalidateFeedCache();
}
