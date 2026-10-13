"use client";

import { db, doc, getDoc, setDoc, serverTimestamp } from "./store";

// Per-user push notification preferences, keyed by uid so the notify API
// routes (which know recipients only by uid) can look them up with one read.
// A missing doc means the defaults: every social notification on AND the 7:27
// daily prompt on — the ritual ships opt-out, so every member hears the
// call unless they deliberately silence it. Preferences only mute pushes —
// the in-app bell feed always records everything.
//
//   notifPrefs/{uid} -> { uid, posts, comments, likes, dms, daily,
//                         quietStart, quietEnd, tz, updatedAt }

export type NotifPrefs = {
  posts: boolean;
  comments: boolean;
  likes: boolean;
  dms: boolean;
  daily: boolean;
  // Minutes since midnight in `tz`; null = no quiet hours.
  quietStart: number | null;
  quietEnd: number | null;
  tz: string;
};

export function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export const DEFAULT_PREFS: NotifPrefs = {
  posts: true,
  comments: true,
  likes: true,
  dms: true,
  daily: true,
  quietStart: null,
  quietEnd: null,
  tz: "America/New_York",
};

export async function loadNotifPrefs(uid: string): Promise<NotifPrefs> {
  const snap = await getDoc(doc(db, "notifPrefs", uid));
  if (!snap.exists()) return { ...DEFAULT_PREFS, tz: browserTz() };
  const d = snap.data();
  return {
    posts: d.posts !== false,
    comments: d.comments !== false,
    likes: d.likes !== false,
    dms: d.dms !== false,
    daily: d.daily !== false,
    quietStart: typeof d.quietStart === "number" ? d.quietStart : null,
    quietEnd: typeof d.quietEnd === "number" ? d.quietEnd : null,
    tz: typeof d.tz === "string" && d.tz ? d.tz : browserTz(),
  };
}

export async function saveNotifPrefs(uid: string, prefs: NotifPrefs) {
  await setDoc(doc(db, "notifPrefs", uid), {
    uid,
    ...prefs,
    // Always restamp the timezone at save time — quiet hours and the 7:27
    // prompt should follow wherever the user actually is.
    tz: browserTz(),
    updatedAt: serverTimestamp(),
  });
}
