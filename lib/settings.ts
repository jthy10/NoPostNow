"use client";

import {
  db,
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "./store";
import * as account from "./account";
import { invalidateAvatarMap } from "./users";
import { sendAdminNote } from "./admin-chat";
import { notifyAdminNote } from "./push";
import { invalidateFeedCache } from "./feed-cache";

export const MAX_USERNAME_LENGTH = 24;
export const MIN_PASSWORD_LENGTH = account.MIN_PASSWORD_LENGTH;
export const MAX_FEEDBACK_LENGTH = 2000;

// Display names double as usernames, so they must be unique. The server
// enforces that on every rename; this check exists to give a friendly message
// before the request is sent.
export async function isUsernameTaken(name: string, myUid: string) {
  const users = await getDocs(collection(db, "users"));
  const needle = name.trim().toLowerCase();
  return users.docs.some(
    (d) => d.id !== myUid && (d.data().username ?? "").toLowerCase() === needle
  );
}

export function validateUsername(name: string): string | null {
  const n = name.trim();
  if (n.length < 2) return "Username must be at least 2 characters.";
  if (n.length > MAX_USERNAME_LENGTH)
    return `Username must be ${MAX_USERNAME_LENGTH} characters or fewer.`;
  if (n.toLowerCase() === "anonymous") return "That name is reserved.";
  if (n.includes("_")) return "Usernames can't contain underscores.";
  return null;
}

// Rename order matters: the server verifies the username stamped onto posts,
// comments, and notifications against the users doc, so that doc must change
// first. Everything carrying the old name then gets restamped so the whole
// app reflects the new one — posts, comments, DM thread names, and bell items
// dropped into friends' feeds.
export async function renameUser(opts: { uid: string; newName: string }) {
  const newName = opts.newName.trim();
  await updateDoc(doc(db, "users", opts.uid), { username: newName });
  await Promise.allSettled([
    propagateUsername(opts.uid, newName),
    propagateDmNames(opts.uid, newName),
    propagateNotificationNames(opts.uid, newName),
  ]);
  invalidateAvatarMap();
  // Cached feed posts still carry the old stamped username — refetch.
  invalidateFeedCache();
}

// DM thread docs cache each participant's display name (names.{uid}) so the
// inbox renders without N user lookups. Restamp mine on every thread I'm in;
// the server takes a name only when it matches that member's profile, which
// is why the users doc changes first.
async function propagateDmNames(uid: string, newName: string) {
  const snap = await getDocs(
    query(collection(db, "dms"), where("uids", "array-contains", uid))
  );
  await Promise.allSettled(
    snap.docs.map((d) => updateDoc(d.ref, { [`names.${uid}`]: newName }))
  );
}

// Bell items I dropped into friends' feeds carry actorName. Rules let the
// actor restamp exactly that field (verified against the users doc).
async function propagateNotificationNames(uid: string, newName: string) {
  const snap = await getDocs(
    query(collectionGroup(db, "items"), where("actorUid", "==", uid))
  );
  await Promise.allSettled(
    snap.docs.map((d) => updateDoc(d.ref, { actorName: newName }))
  );
}

// Restamp username onto every post and comment this uid authored. Shared by
// self-serve rename and (with their own rules path) the admin rename.
export async function propagateUsername(uid: string, newName: string) {
  const [photos, comments] = await Promise.all([
    getDocs(query(collection(db, "photos"), where("userUUID", "==", uid))),
    getDocs(query(collectionGroup(db, "comments"), where("userUUID", "==", uid))),
  ]);
  const results = await Promise.allSettled([
    ...photos.docs.map((d) => updateDoc(d.ref, { username: newName })),
    ...comments.docs.map((d) => updateDoc(d.ref, { username: newName })),
  ]);
  const failed = results.filter((r) => r.status === "rejected").length;
  return { updated: results.length - failed, failed };
}

// Account changes ask for the current password every time; the server
// refuses them otherwise, however fresh the session is.
export async function changePassword(currentPassword: string, newPassword: string) {
  await account.changePassword(currentPassword, newPassword);
}

// Returns the address as the server stored it.
export async function changeEmail(currentPassword: string, newEmail: string): Promise<string> {
  return account.changeEmail(currentPassword, newEmail);
}

// Soft delete: posts get flagged, never removed — images and comments stay
// on the server, the feed just skips them, and the admin can recover them.
export async function softDeleteAllMyPosts(uid: string) {
  const snap = await getDocs(query(collection(db, "photos"), where("userUUID", "==", uid)));
  const live = snap.docs.filter((d) => d.data().deleted !== true);
  const results = await Promise.allSettled(
    live.map((d) => updateDoc(d.ref, { deleted: true, deletedAt: serverTimestamp() }))
  );
  invalidateFeedCache();
  const failed = results.filter((r) => r.status === "rejected").length;
  return { deleted: results.length - failed, failed };
}

// Removes the login, the profile and every post and photo the member owns.
// The server does all of it in one step, so a dropped connection can't leave
// a half-deleted account behind.
export async function deleteMyAccount(currentPassword: string) {
  await account.deleteAccount(currentPassword);
  invalidateAvatarMap();
  invalidateFeedCache();
}

// A note to the admins — lands in the admin panel, and is mirrored into
// the member's admins chat so there is one inbox to answer from
// instead of two. This form is the web fallback: the chat itself lives in
// /dm, which only the installed app can reach.
export async function sendFeedback(opts: { uid: string; username: string; text: string }) {
  const text = opts.text.trim().slice(0, MAX_FEEDBACK_LENGTH);
  await addDoc(collection(db, "feedback"), {
    uid: opts.uid,
    username: opts.username,
    text,
    at: serverTimestamp(),
  });
  // Best-effort: the note is already filed, and a member with no users doc
  // yet would fail the chat's username check. Never fail the send over it.
  try {
    await sendAdminNote({ uid: opts.uid, username: opts.username, text });
    void notifyAdminNote(text);
  } catch {
    // The admin panel still has it.
  }
}
