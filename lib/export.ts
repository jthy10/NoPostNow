"use client";

import {
  db,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "./store";
import type { User } from "./account";
import { site } from "./site";

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
}

// "Download my data": everything the app stores about this member, gathered
// client-side with their own session (so the server's access rules are the audit —
// nothing is exported that they couldn't already read) and saved as one JSON
// file. Photos aren't embedded — each post lists its storage path, and the
// download button on any post fetches the original.

type Jsonish = Record<string, unknown>;

// Timestamps aren't JSON — flatten every value that quacks like one.
function plain(data: Record<string, unknown>): Jsonish {
  const out: Jsonish = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "toDate" in v && typeof v.toDate === "function") {
      out[k] = (v as { toDate: () => Date }).toDate().toISOString();
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = plain(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function buildExport(user: User): Promise<Jsonish> {
  const uid = user.uid;

  const [profile, prefs, blocks, myPosts, myComments, likedPosts, threads] =
    await Promise.all([
      getDoc(doc(db, "users", uid)).catch(() => null),
      getDoc(doc(db, "notifPrefs", uid)).catch(() => null),
      getDoc(doc(db, "blocks", uid)).catch(() => null),
      getDocs(query(collection(db, "photos"), where("userUUID", "==", uid))),
      getDocs(query(collectionGroup(db, "comments"), where("userUUID", "==", uid))),
      getDocs(query(collection(db, "photos"), where("likedBy", "array-contains", uid))),
      getDocs(query(collection(db, "dms"), where("uids", "array-contains", uid))).catch(
        () => null
      ),
    ]);

  // DM messages, thread by thread (few members — a handful of threads).
  const dms: Jsonish[] = [];
  for (const t of threads?.docs ?? []) {
    const messages = await getDocs(
      query(collection(db, "dms", t.id, "messages"))
    ).catch(() => null);
    dms.push({
      thread: plain(t.data()),
      messages: messages?.docs.map((m) => plain(m.data())) ?? [],
    });
  }

  return {
    exportedAt: new Date().toISOString(),
    account: {
      email: user.email,
      uid,
      created: new Date(user.createdAt).toISOString(),
    },
    profile: profile?.exists() ? plain(profile.data()!) : null,
    notificationPreferences: prefs?.exists() ? plain(prefs.data()!) : null,
    blockedUsers: blocks?.exists() ? plain(blocks.data()!) : null,
    posts: myPosts.docs.map((d) => ({ id: d.id, ...plain(d.data()) })),
    comments: myComments.docs.map((d) => ({
      id: d.id,
      postId: d.ref.parent.parent?.id ?? null,
      ...plain(d.data()),
    })),
    likedPosts: likedPosts.docs.map((d) => ({ id: d.id, ...plain(d.data()) })),
    directMessages: dms,
  };
}

export async function downloadExport(user: User) {
  const data = await buildExport(user);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(site().siteName)}-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
