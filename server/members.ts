import { deleteAccount } from "./core/accounts.ts";
import { disposeFolder, disposePostFiles } from "./files.ts";
import { db } from "./runtime.ts";
import { announce, listCollection, removeChildren, removeDoc } from "./store.ts";

// Everything a departing member owns, removed: their posts and the image
// files behind them, avatars, devices, bell feed and preferences. Comments and
// messages they sent to other people stay with those people. The files are
// erased, or set aside in the deleted folder if the admin keeps deleted files.
export function eraseMember(uid: string) {
  for (const post of listCollection("photos")) {
    if (post.data.userUUID !== uid) continue;
    removeChildren(post.path);
    removeDoc(post.path);
    disposePostFiles(post.data);
    announce({ parent: "photos", path: post.path, data: post.data });
  }
  for (const sub of listCollection("pushSubscriptions")) {
    if (sub.data.uid === uid) removeDoc(sub.path);
  }
  for (const root of ["notifications", "notifPrefs", "blocks", "adminChats", "users"]) {
    removeChildren(`${root}/${uid}`);
    removeDoc(`${root}/${uid}`);
  }
  for (const folder of ["photos/display", "photos", "avatars"]) disposeFolder(`${folder}/${uid}`);
  deleteAccount(db(), uid);
  announce({ parent: "users", path: `users/${uid}`, data: {} });
}
