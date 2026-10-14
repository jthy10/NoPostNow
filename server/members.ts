import fs from "node:fs";
import path from "node:path";
import { deleteAccount } from "./core/accounts.ts";
import { displayVariantPath, removeFile } from "./files.ts";
import { db, filesDir } from "./runtime.ts";
import { announce, listCollection, removeChildren, removeDoc } from "./store.ts";

// Everything a departing member owns, removed for good: their posts and the
// image files behind them, avatars, devices, bell feed and preferences.
// Comments and messages they sent to other people stay with those people.
export function eraseMember(uid: string) {
  for (const post of listCollection("photos")) {
    if (post.data.userUUID !== uid) continue;
    removeChildren(post.path);
    removeDoc(post.path);
    if (typeof post.data.imagePath === "string") {
      removeFile(post.data.imagePath);
      removeFile(displayVariantPath(post.data.imagePath));
    }
    announce({ parent: "photos", path: post.path, data: post.data });
  }
  for (const sub of listCollection("pushSubscriptions")) {
    if (sub.data.uid === uid) removeDoc(sub.path);
  }
  for (const root of ["notifications", "notifPrefs", "blocks", "adminChats", "users"]) {
    removeChildren(`${root}/${uid}`);
    removeDoc(`${root}/${uid}`);
  }
  for (const folder of ["photos", "photos/display", "avatars"]) {
    fs.rmSync(path.join(filesDir(), ...folder.split("/"), uid), { recursive: true, force: true });
  }
  deleteAccount(db(), uid);
  announce({ parent: "users", path: `users/${uid}`, data: {} });
}
