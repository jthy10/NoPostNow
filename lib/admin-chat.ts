"use client";

import { useEffect, useMemo, useState } from "react";
import {
  db,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from "./store";
import { adminChatName, adminSenderName } from "./site";

// The admins chat — one conversation per member, always there,
// never created by a search. It is deliberately *not* a `dms/{threadId}`
// thread: a DM belongs to two people, and the admin is a role here, not a
// peer. Keeping it in its own collection means the admin can still have an
// ordinary private DM with the same person, and it lets the admin read every
// member's chat from one place.
//
//   adminChats/{uid}           -> { uid, username, lastText, lastFrom,
//                                   lastAt, userSeenAt, adminSeenAt }
//   adminChats/{uid}/notes/{id} -> { from: 'user' | 'admin', text, at }
//
// `from` is a role, not a uid, so the admin's side always renders as
// as the site admin no matter whose account is behind it.

export { adminChatName, adminSenderName };
export const ADMIN_CHAT_HREF = "/dm/admins";

export const ADMIN_CHAT_BANNER =
  "Leave a note for the people who run this site — problems, requests, anything else.";

export const ADMIN_CHAT_TAGLINE = "Problems, requests, comments";

// Sent back to the member the moment their note lands. Rendered from the
// thread's own shape rather than stored, so nobody can forge an admin
// message by writing one — see AUTO_ACK handling in the member chat.
export const ADMIN_AUTO_REPLY = "Message received and delivered — thank you!";

export const MAX_NOTE_LENGTH = 1000;

export type AdminChat = {
  uid: string;
  username?: string;
  lastText?: string;
  lastFrom?: "user" | "admin";
  lastAt: Timestamp | null;
  userSeenAt?: Timestamp | null;
  adminSeenAt?: Timestamp | null;
};

export type AdminNote = {
  id: string;
  uid: string; // whose chat it belongs to
  from: "user" | "admin";
  text: string;
  at: Timestamp | null;
};

// Unread for the member: the admin wrote last, and it landed after the
// member's last look.
export function isUnreadForMember(chat: AdminChat | null | undefined) {
  if (!chat?.lastAt || chat.lastFrom !== "admin") return false;
  const seen = chat.userSeenAt;
  return !seen || chat.lastAt.toMillis() > seen.toMillis();
}

// Unread for the admin: the member wrote last, and it landed after the
// admin's last look at *that* member's chat.
export function isUnreadForAdmin(chat: AdminChat) {
  if (!chat.lastAt || chat.lastFrom !== "user") return false;
  const seen = chat.adminSeenAt;
  return !seen || chat.lastAt.toMillis() > seen.toMillis();
}

// A note still waiting on the admin: nothing from the admin has landed since.
export function isAwaitingReply(note: AdminNote, chat: AdminChat | undefined) {
  if (!note.at) return true;
  if (!chat?.lastAt || chat.lastFrom !== "admin") return true;
  return chat.lastAt.toMillis() < note.at.toMillis();
}

// ---- member side ------------------------------------------------------------

// One member's chat doc, live. undefined = still loading, null = no chat yet.
export function useAdminChat(uid: string | undefined) {
  const [chat, setChat] = useState<AdminChat | null | undefined>(undefined);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, "adminChats", uid),
      (snap) => setChat(snap.exists() ? ({ ...snap.data(), uid: snap.id } as AdminChat) : null),
      () => setChat(null)
    );
  }, [uid]);

  return chat;
}

// One member's notes, live, oldest-first for rendering.
export function useAdminNotes(uid: string | undefined, max = 200) {
  const [notes, setNotes] = useState<AdminNote[] | null>(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, "adminChats", uid, "notes"), orderBy("at", "desc"), limit(max)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, uid, ...d.data() } as AdminNote));
        // A just-sent note has a pending server timestamp (at == null on this
        // device) — treat it as newest so it renders at the bottom.
        list.sort((a, b) => (a.at?.toMillis() ?? Infinity) - (b.at?.toMillis() ?? Infinity));
        setNotes(list);
      },
      () => setNotes([])
    );
  }, [uid, max]);

  return notes;
}

// ---- admin side -------------------------------------------------------------

// Every member's chat, live. Sorted client-side — the member list is small, and it
// keeps the query index-free.
export function useAllAdminChats(enabled: boolean) {
  const [chats, setChats] = useState<AdminChat[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      collection(db, "adminChats"),
      (snap) => {
        const list = snap.docs.map((d) => ({ ...d.data(), uid: d.id } as AdminChat));
        list.sort((a, b) => (b.lastAt?.toMillis() ?? 0) - (a.lastAt?.toMillis() ?? 0));
        setChats(list);
      },
      () => setChats([])
    );
  }, [enabled]);

  return chats;
}

// Every note every member has written, newest first — the admin's inbox.
//
// One listener per member's chat, so each conversation refreshes on its own
// when a note arrives instead of reloading the whole inbox.
// The member list is small; this is a handful of listeners. Takes the chat list the
// caller is already subscribed to rather than opening a second one.
export function useAdminInbox(chats: AdminChat[] | null, perChat = 100) {
  const [byUid, setByUid] = useState<Map<string, AdminNote[]>>(new Map());

  // Keyed on the *set* of members, not the chat list itself — the list
  // reorders on every new note, and that must not tear down every listener.
  const uidKey = useMemo(
    () => (chats ?? []).map((c) => c.uid).sort().join(","),
    [chats]
  );

  useEffect(() => {
    if (!uidKey) return;
    const unsubs = uidKey.split(",").map((uid) =>
      onSnapshot(
        query(collection(db, "adminChats", uid, "notes"), orderBy("at", "desc"), limit(perChat)),
        (snap) =>
          setByUid((prev) =>
            new Map(prev).set(
              uid,
              snap.docs.map((d) => ({ id: d.id, uid, ...d.data() } as AdminNote))
            )
          ),
        () => setByUid((prev) => new Map(prev).set(uid, []))
      )
    );
    return () => {
      for (const stop of unsubs) stop();
    };
  }, [uidKey, perChat]);

  return useMemo(() => {
    if (chats === null) return null;
    // Still filling: hold the loading state rather than flash a partial inbox.
    if (chats.some((c) => !byUid.has(c.uid))) return null;
    const all = chats.flatMap((c) => byUid.get(c.uid) ?? []);
    // Newest first. A note the admin just sent has a pending server timestamp
    // (at == null on this device) — treat it as newest, same as everywhere else.
    all.sort((a, b) => (b.at?.toMillis() ?? Infinity) - (a.at?.toMillis() ?? Infinity));
    return all;
  }, [chats, byUid]);
}

// ---- writes -----------------------------------------------------------------

// A member's note. Upserts the chat doc first (create carries the exact shape
// the rules validate), then appends. Sending is reading: the member's own seen
// pointer rides along so their unread dot doesn't light up on their own words.
export async function sendAdminNote(opts: {
  uid: string;
  username: string;
  text: string;
}) {
  const text = opts.text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!text) return;
  await setDoc(
    doc(db, "adminChats", opts.uid),
    {
      uid: opts.uid,
      username: opts.username,
      lastText: text.slice(0, 120),
      lastFrom: "user",
      lastAt: serverTimestamp(),
      userSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
  await addDoc(collection(db, "adminChats", opts.uid, "notes"), {
    from: "user",
    text,
    at: serverTimestamp(),
  });
}

// The admin's reply into one member's chat. Always signed as the role, never
// as the account behind it.
export async function sendAdminReply(opts: { uid: string; text: string }) {
  const text = opts.text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!text) return;
  await setDoc(
    doc(db, "adminChats", opts.uid),
    {
      uid: opts.uid,
      lastText: text.slice(0, 120),
      lastFrom: "admin",
      lastAt: serverTimestamp(),
      adminSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
  await addDoc(collection(db, "adminChats", opts.uid, "notes"), {
    from: "admin",
    text,
    at: serverTimestamp(),
  });
}

// Mark a chat read from one side. No-ops when the chat doesn't exist yet.
export async function markAdminChatSeen(uid: string, side: "user" | "admin") {
  try {
    await updateDoc(doc(db, "adminChats", uid), {
      [side === "admin" ? "adminSeenAt" : "userSeenAt"]: serverTimestamp(),
    });
  } catch {
    // Nothing written to this chat yet — nothing to mark.
  }
}

// ---- badge ------------------------------------------------------------------

// The admins row counts as one unread thread, for members and for the
// admin alike: it is one row in /dm, so a badge of 2 that opens onto a single
// chat would be a lie. Members read their own doc; the admin lists them all.
export function useAdminChatUnread(uid: string | undefined, admin: boolean) {
  const mine = useAdminChat(admin ? undefined : uid);
  const all = useAllAdminChats(admin);
  return useMemo(() => {
    if (!uid) return 0;
    if (admin) return all?.some(isUnreadForAdmin) ? 1 : 0;
    return isUnreadForMember(mine) ? 1 : 0;
  }, [uid, admin, all, mine]);
}
