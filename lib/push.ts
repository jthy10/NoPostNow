"use client";

import { db, doc, deleteDoc, setDoc, serverTimestamp } from "./store";
import { apiPost } from "./api";
import { currentUid } from "./account";
import { site } from "./site";
import {
  recordPostNotification,
  recordCommentNotification,
  recordLikeNotification,
  recordMentionNotification,
  recordCommentLikeNotification,
} from "@/lib/notifications";

// The server's push signing key, public half. Empty when the host hasn't
// set push up, in which case notifications are simply unavailable.
function vapidKey() {
  return site().vapidPublicKey.replace(/[^A-Za-z0-9_-]/g, "");
}

// Launched from a home-screen icon (vs a browser tab)?
export function isStandalone() {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true)
  );
}

export function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(vapidKey())
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Endpoint URLs contain "/" so they can't be doc ids — hash them. One doc
// per device; re-subscribing the same device overwrites its own doc.
async function endpointDocId(endpoint: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Every failure names the stage that broke so the UI can show it — "it
// returned false" was undebuggable on a phone.
export type PushOutcome = { ok: true } | { ok: false; reason: string };

function errMsg(e: unknown) {
  // String codes (the server's "permission-denied") beat the message; numeric
  // codes (DOMException legacy) don't — prefer the name then.
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

// Subscribe this device (permission must already be granted) and record the
// subscription so the notify endpoint can reach it. Safe to call repeatedly.
export async function ensurePushSubscription(uid: string): Promise<PushOutcome> {
  if (!pushSupported()) return { ok: false, reason: "push unsupported" };
  if (Notification.permission !== "granted")
    return { ok: false, reason: `permission ${Notification.permission}` };

  // getRegistration() is undefined until the worker registers — fall back to
  // waiting for it (bounded, since `ready` never resolves if register failed).
  let reg: ServiceWorkerRegistration | null | undefined;
  try {
    reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((res) => setTimeout(() => res(null), 4000)),
      ]);
    }
  } catch (e) {
    return { ok: false, reason: `sw: ${errMsg(e)}` };
  }
  if (!reg) return { ok: false, reason: "no service worker" };

  let sub: PushSubscription | null;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey()),
      });
    }
  } catch (e) {
    return { ok: false, reason: `subscribe: ${errMsg(e)}` };
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
    return { ok: false, reason: "incomplete subscription" };

  try {
    await setDoc(doc(db, "pushSubscriptions", await endpointDocId(json.endpoint)), {
      uid,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    return { ok: false, reason: `save: ${errMsg(e)}` };
  }
  return { ok: true };
}

// Signing out: this device stops receiving the departing member's
// notifications. The browser's own subscription is kept, so the next member
// to sign in here registers without being asked for permission again.
export async function forgetPushSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await deleteDoc(doc(db, "pushSubscriptions", await endpointDocId(sub.endpoint)));
  } catch {
    // Offline or unsupported — signing out must still go ahead.
  }
}

// Ask for permission (must be called from a user gesture on iOS), then subscribe.
export async function requestPushPermission(uid: string): Promise<PushOutcome> {
  if (!pushSupported()) return { ok: false, reason: "push unsupported" };
  let perm: NotificationPermission;
  try {
    perm = await Notification.requestPermission();
  } catch (e) {
    return { ok: false, reason: `prompt: ${errMsg(e)}` };
  }
  if (perm !== "granted") return { ok: false, reason: `permission ${perm}` };
  return ensurePushSubscription(uid);
}

// Fire-and-forget notification fan-out. Never allowed to break or slow down
// the action (post/comment/like/DM) that triggered it.
//
// The body describes the event only. The sender's display name is not sent —
// the route reads it from their users doc, so a hand-rolled client can't sign
// a push with someone else's name.
async function sendNotify(body: Record<string, string | string[]>) {
  try {
    await apiPost("/api/notify-post", body);
  } catch {
    // Push is best-effort — never block the action that triggered it.
  }
}

export async function notifyNewPost(username: string, caption: string, postId: string) {
  const uid = currentUid();
  await Promise.allSettled([
    sendNotify({ type: "post", postId }),
    uid ? recordPostNotification(uid, username, postId, caption) : Promise.resolve(),
  ]);
}

// "X commented: …" → the post owner AND everyone else who commented on the
// post, so a thread's participants can keep talking. `participantUids` are the
// other commenters; we merge them with the owner, dedupe, and drop the actor.
export async function notifyComment(
  username: string,
  text: string,
  ownerUid: string,
  postId: string,
  participantUids: string[] = []
) {
  const uid = currentUid();
  const targets = [...new Set([ownerUid, ...participantUids])].filter(
    (u) => u && u !== uid
  );
  if (targets.length === 0) return;
  await Promise.allSettled([
    sendNotify({ type: "comment", text, targetUids: targets, postId }),
    uid ? recordCommentNotification(uid, username, postId, text, targets) : Promise.resolve(),
  ]);
}

// "X liked your photo" → the post owner only. Legacy Anonymous imports have no
// recorded owner, so there is nobody to tell; bail rather than send a targeted
// push with an empty target list (the route rejects those too, belt and braces).
export async function notifyLike(
  username: string,
  targetUid: string | null | undefined,
  postId: string
) {
  const uid = currentUid();
  if (!targetUid || targetUid === uid) return;
  await Promise.allSettled([
    sendNotify({ type: "like", targetUid, postId }),
    uid ? recordLikeNotification(uid, username, postId, targetUid) : Promise.resolve(),
  ]);
}

// "X mentioned you: …" → the members named with @ in a comment. The comment's
// generic fan-out (notifyComment) is expected to exclude these people, so a
// mention lands as one richer notification instead of two. Actor dropped.
export async function notifyMention(
  username: string,
  text: string,
  targetUids: string[],
  postId: string
) {
  const uid = currentUid();
  const targets = [...new Set(targetUids)].filter((u) => u && u !== uid);
  if (targets.length === 0) return;
  await Promise.allSettled([
    sendNotify({ type: "mention", text, targetUids: targets, postId }),
    uid ? recordMentionNotification(uid, username, postId, text, targets) : Promise.resolve(),
  ]);
}

// "X liked your comment" → the comment's author only.
export async function notifyCommentLike(username: string, authorUid: string, postId: string) {
  const uid = currentUid();
  if (!authorUid || authorUid === uid) return;
  await Promise.allSettled([
    sendNotify({ type: "commentLike", targetUid: authorUid, postId }),
    uid ? recordCommentLikeNotification(uid, username, postId, authorUid) : Promise.resolve(),
  ]);
}

// "X: message" → the recipient's devices. DMs never touch the bell feed —
// they land straight in /dm with their own badge. No name argument: the route
// resolves the sender itself and verifies they belong to the thread.
export async function notifyDm(text: string, targetUid: string, threadId: string) {
  if (!targetUid || !threadId) return;
  await sendNotify({ type: "dm", text, targetUid, threadId });
}

// A member's note in the admins chat → the admin's devices. No target
// uid is sent: the route resolves the admin from their own users doc, so a
// hand-rolled client can't aim this at somebody else.
export async function notifyAdminNote(text: string) {
  await sendNotify({ type: "adminNote", text });
}

// The admin's reply → that member's devices, signed as the site admin. The route
// verifies the caller really is the admin before it sends.
export async function notifyAdminReply(text: string, targetUid: string) {
  if (!targetUid) return;
  await sendNotify({ type: "adminReply", text, targetUid });
}
