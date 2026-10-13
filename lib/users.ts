"use client";

import { useEffect, useState } from "react";
import { db, collection, getDocs, limit, query, where } from "./store";

export type UserMeta = {
  username: string;
  avatarPath: string | null;
  uid: string | null;
  joinedAt: Date | null;
  appAt: Date | null; // first launch from the Home Screen — "has the PWA"
  // Most recent post time, stamped onto the user's own doc by createPost —
  // the "recently active" signal the @mention picker ranks by. Null when they
  // haven't posted since the field existed.
  lastActiveAt?: Date | null;
};

// One fetch of the (small) users collection per session, shared by every
// avatar in the feed, comment sheets, and profile pages.
let mapPromise: Promise<UserMeta[]> | null = null;

function allUsers(): Promise<UserMeta[]> {
  mapPromise ??= getDocs(collection(db, "users")).then((snap) => {
    const list: UserMeta[] = [];
    snap.forEach((d) => {
      const { username, avatarPath, uid, joinedAt, appAt, lastPostAt } = d.data();
      if (!username) return;
      list.push({
        username,
        avatarPath: avatarPath ?? null,
        uid: uid ?? null,
        joinedAt: joinedAt?.toDate?.() ?? null,
        appAt: appAt?.toDate?.() ?? null,
        lastActiveAt: lastPostAt?.toDate?.() ?? null,
      });
    });
    return list;
  });
  return mapPromise;
}

// After the signed-in user changes their own avatar or username (or their
// doc self-heals). Clears the derived DM-search list too — it's built from
// the same user docs, so a rename must not leave the old name in search.
export function invalidateAvatarMap() {
  mapPromise = null;
  messageablePromise = null;
}

// The full member list (session-cached) — DM search and new-post
// notification fan-out both need everyone, not one lookup.
export function fetchAllUsers(): Promise<UserMeta[]> {
  return allUsers();
}

// The users collection can under-count: uid only self-heals into a user doc
// when that person signs in, so friends who haven't been back since profiles
// shipped have uid: null. Their posts carry userUUID though, so the photos
// collection can fill the gap.
//
// This used to read *every* photo in the archive to build a username -> uid
// map — hundreds of document reads, growing forever, on the first comment
// sheet or DM list of every session. Instead, ask only about the handful of
// members actually missing a uid: one single-doc query each, and none at all
// once everyone has signed in since the self-heal shipped.
let messageablePromise: Promise<UserMeta[]> | null = null;

async function uidFromPosts(username: string): Promise<string | null> {
  const snap = await getDocs(
    query(collection(db, "photos"), where("username", "==", username), limit(1))
  ).catch(() => null);
  const uuid = snap?.docs[0]?.data().userUUID;
  return typeof uuid === "string" && uuid ? uuid : null;
}

export function fetchMessageableUsers(): Promise<UserMeta[]> {
  messageablePromise ??= (async () => {
    const users = await allUsers();
    const missing = users.filter((u) => !u.uid);
    if (missing.length === 0) return users;

    const resolved = new Map(
      await Promise.all(
        missing.map(async (u) => [u.username, await uidFromPosts(u.username)] as const)
      )
    );
    return users.map((u) => ({ ...u, uid: u.uid ?? resolved.get(u.username) ?? null }));
  })();
  return messageablePromise;
}

// Live uid -> current display name, from the session users cache. Views that
// stored a name snapshot at write time (bell items carry actorName, DM threads
// cache names.{uid}) resolve through this so a rename — whether the member did
// it in settings or an admin did it from the panel — shows up everywhere at
// once, with no need to restamp every old record. Falls back to the snapshot
// for anyone the cache can't resolve (e.g. a friend with no users doc yet).
export function useNamesByUid(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetchMessageableUsers().then((users) => {
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const u of users) if (u.uid) map.set(u.uid, u.username);
      setNames(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}

// Members selectable as @mentions, most recently active first. Ranked by last
// post time, falling back to when they got the app / joined so newcomers who
// haven't posted still sort sensibly. Everyone with a uid is included (the
// signed-in user too, so their own name still highlights when mentioned) —
// the composer filters itself and blocked users out of the picker.
export type MentionCandidate = { uid: string; username: string; avatarPath: string | null };

export function useMentionUsers(): MentionCandidate[] {
  const [list, setList] = useState<MentionCandidate[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchMessageableUsers().then((users) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const ranked = users
        .filter((u) => Boolean(u.uid) && Boolean(u.username))
        .map((u) => ({
          uid: u.uid as string,
          username: u.username,
          avatarPath: u.avatarPath,
          score: (u.lastActiveAt ?? u.appAt ?? u.joinedAt)?.getTime() ?? 0,
        }))
        .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
        .filter((u) => (seen.has(u.uid) ? false : (seen.add(u.uid), true)))
        .map(({ uid, username, avatarPath }) => ({ uid, username, avatarPath }));
      setList(ranked);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return list;
}

export function useAvatarPath(username: string | null | undefined) {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    allUsers().then((users) => {
      if (cancelled) return;
      setPath(users.find((u) => u.username === username)?.avatarPath ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  return path;
}

// Profile lookup by uid. `uid` fields self-heal into user docs on sign-in,
// so a friend who hasn't opened the app since the update resolves to null —
// callers fall back to what their posts say.
export function useUserByUid(uid: string | null | undefined) {
  const [meta, setMeta] = useState<UserMeta | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    allUsers().then((users) => {
      if (!cancelled) setMeta(users.find((u) => u.uid === uid) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return meta;
}
