import { usernameTaken, validateUsername } from "./core/accounts.ts";
import { db } from "./runtime.ts";
import { isAdmin, isFreshAdmin, type Session } from "./session.ts";
import { changedKeys, deepEqual, getDoc, millis, type Data, type Json } from "./store.ts";

// Who may read and write which documents. Every request to the document store
// passes through here; anything not explicitly allowed below is refused.
//
// `before` is the stored document (null when it does not exist) and `after`
// is what it would become. Rules compare the two, so a write is judged by its
// effect rather than by what the client says it is doing.

export type Action = "create" | "update" | "delete";

type Ctx = { session: Session | null; uid: string; now: number };

const isString = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;

function onlyKeys(data: Data, allowed: string[]): boolean {
  return Object.keys(data).every((k) => allowed.includes(k));
}

function touchesOnly(before: Data | null, after: Data, allowed: string[]): boolean {
  return changedKeys(before, after).every((k) => allowed.includes(k));
}

// True when the field was set with a server timestamp in this very write.
function isNow(value: Json | undefined, ctx: Ctx): boolean {
  return millis(value) === ctx.now;
}

function ownProfile(ctx: Ctx): Data | null {
  return getDoc(`users/${ctx.uid}`)?.data ?? null;
}

function ownUsername(ctx: Ctx): string | null {
  const name = ownProfile(ctx)?.username;
  return typeof name === "string" ? name : null;
}

// Admin mute: muted members can browse and like but not post or comment.
function notMuted(ctx: Ctx): boolean {
  return ownProfile(ctx)?.muted !== true;
}

// A like toggle may add or remove the caller's own uid and nothing else.
function ownLikeToggle(before: Data, after: Data, ctx: Ctx): boolean {
  if (!touchesOnly(before, after, ["likedBy"]) || !Array.isArray(after.likedBy)) return false;
  const was = Array.isArray(before.likedBy) ? before.likedBy : [];
  const now = after.likedBy;
  if (now.some((v) => typeof v !== "string")) return false;
  const added = now.filter((v) => !was.includes(v));
  const removed = was.filter((v) => !now.includes(v));
  return [...added, ...removed].every((v) => v === ctx.uid);
}

function inThread(threadId: string, uid: string): boolean {
  return threadId.split("_").includes(uid);
}

// --- reads -----------------------------------------------------------------

export function canRead(session: Session | null, path: string, data: Data | null): boolean {
  if (!session) return false;
  const uid = session.account.uid;
  const admin = isAdmin(session);
  const p = path.split("/");

  switch (p[0]) {
    case "users":
    case "config":
      return p.length === 2;
    case "photos":
      // Posts and their comments are visible to every member.
      return p.length === 2 || (p.length === 4 && p[2] === "comments");
    case "blocks":
      // Blocking is mutual invisibility, so members must be able to find the
      // lists that contain them.
      return p.length === 2;
    case "adminLog":
    case "feedback":
      return admin;
    case "claims":
      return admin || data?.uid === uid;
    case "notifPrefs":
    case "unique_users":
      return p[1] === uid;
    case "pushSubscriptions":
      return admin || data?.uid === uid;
    case "notifications":
      if (p[1] === uid) return true;
      // Authors may find the bell items they dropped into friends' feeds, to
      // restamp their name after a rename.
      return p.length === 4 && p[2] === "items" && data?.actorUid === uid;
    case "dms":
      return inThread(p[1], uid);
    case "adminChats":
      return p[1] === uid || admin;
    default:
      return false;
  }
}

// --- writes ----------------------------------------------------------------

export function canWrite(
  session: Session | null,
  action: Action,
  path: string,
  before: Data | null,
  after: Data | null,
  now: number
): boolean {
  if (!session) return false;
  const ctx: Ctx = { session, uid: session.account.uid, now };
  const admin = isAdmin(session);
  const fresh = isFreshAdmin(session);
  const p = path.split("/");
  const { uid } = ctx;

  switch (p[0]) {
    // users/{uid} -> { uid, username, avatarPath, joinedAt, appAt, lastPostAt,
    //                  mascot, muted }
    // Profiles are created with the account (never by a client) and hold no
    // email address. Members edit their own; only an admin sets `muted`.
    case "users": {
      if (p.length !== 2) return false;
      if (action === "create") return false;
      if (action === "delete") return false;
      if (!before || !after || after.uid !== p[1]) return false;
      const renamed = !deepEqual(before.username, after.username);
      if (renamed) {
        if (validateUsername(after.username) !== null) return false;
        if (usernameTaken(db(), String(after.username), p[1])) return false;
      }
      if (fresh) return true;
      if (p[1] !== uid) return false;
      if (
        !onlyKeys(after, [
          "uid", "username", "avatarPath", "joinedAt", "createdAt", "appAt", "lastPostAt",
          "mascot", "muted",
        ])
      ) {
        return false;
      }
      if (!touchesOnly(before, after, ["username", "avatarPath", "appAt", "lastPostAt", "mascot"])) {
        return false;
      }
      if (
        after.avatarPath != null &&
        !(isString(after.avatarPath, 200) && after.avatarPath.startsWith(`avatars/${uid}/`))
      ) {
        return false;
      }
      return after.mascot == null || isString(after.mascot, 20);
    }

    // config/{docId} -> instance-wide settings the admin edits (announcement).
    case "config":
      return p.length === 2 && fresh;

    // adminLog/{entryId} -> append-only audit trail. Never updated or deleted.
    case "adminLog":
      return p.length === 2 && action === "create" && fresh && isNow(after?.at, ctx);

    case "unique_users":
      return p[1] === uid;

    // pushSubscriptions/{id} -> { uid, endpoint, p256dh, auth, updatedAt }
    // A device is registered under its owner's uid and cannot be taken over.
    case "pushSubscriptions": {
      if (p.length !== 2) return false;
      if (action === "delete") return before?.uid === uid || fresh;
      const own =
        after?.uid === uid &&
        isString(after.endpoint, 1000, 1) &&
        /^https:\/\//.test(after.endpoint) &&
        isString(after.p256dh, 300, 1) &&
        isString(after.auth, 300, 1);
      return action === "create" ? own : before?.uid === uid && own;
    }

    // notifications/{uid} -> { seenAt }; items/{id} -> the in-app bell feed.
    // A member may drop an item into a friend's feed, but only as themselves
    // and never into their own.
    case "notifications": {
      if (p.length === 2) return p[1] === uid;
      if (p.length !== 4 || p[2] !== "items") return false;
      if (action === "delete") return p[1] === uid;
      if (!after) return false;
      if (action === "update") {
        return (
          before?.actorUid === uid &&
          touchesOnly(before, after, ["actorName"]) &&
          after.actorName === ownUsername(ctx)
        );
      }
      if (p[1] === uid) return false;
      if (!getDoc(`users/${p[1]}`)) return false;
      if (!onlyKeys(after, ["type", "actorUid", "actorName", "postId", "text", "at"])) return false;
      if (after.actorUid !== uid || after.actorName !== ownUsername(ctx)) return false;
      if (!isString(after.postId, 120) || !isNow(after.at, ctx)) return false;
      const type = after.type;
      if (type === "post" || type === "comment" || type === "mention") {
        return notMuted(ctx) && (after.text === undefined || isString(after.text, 200));
      }
      return (type === "like" || type === "commentLike") && after.text === undefined;
    }

    // notifPrefs/{uid} -> push preferences and quiet hours, owner only.
    case "notifPrefs": {
      if (p.length !== 2 || p[1] !== uid) return false;
      if (action === "delete") return true;
      if (!after) return false;
      const minute = (v: Json | undefined) =>
        v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1439);
      return (
        onlyKeys(after, [
          "uid", "posts", "comments", "likes", "dms", "daily", "quietStart", "quietEnd", "tz",
          "updatedAt",
        ]) &&
        after.uid === uid &&
        ["posts", "comments", "likes", "dms", "daily"].every((k) => typeof after[k] === "boolean") &&
        minute(after.quietStart) &&
        minute(after.quietEnd) &&
        isString(after.tz, 64)
      );
    }

    // blocks/{uid} -> { blocked: [uid, ...] }
    case "blocks": {
      if (p.length !== 2 || p[1] !== uid) return false;
      if (action === "delete") return true;
      return (
        !!after &&
        onlyKeys(after, ["blocked"]) &&
        Array.isArray(after.blocked) &&
        after.blocked.length <= 500 &&
        after.blocked.every((v) => isString(v, 64))
      );
    }

    // dms/{threadId} -> { uids: [a, b], names, lastText, lastFrom, lastAt,
    //                     seenAt, clearedAt }
    // The id is both uids sorted and joined with "_", so membership is read
    // off the id. Only the two participants see anything.
    case "dms": {
      if (!inThread(p[1], uid)) return false;
      if (p.length === 2) {
        if (action === "delete" || !after) return false;
        const uids = after.uids;
        if (action === "create") {
          return (
            Array.isArray(uids) &&
            uids.length === 2 &&
            isString(uids[0], 64, 1) &&
            isString(uids[1], 64, 1) &&
            uids[0] < uids[1] &&
            p[1] === `${uids[0]}_${uids[1]}` &&
            uids.every((u) => !!getDoc(`users/${u}`)) &&
            after.clearedAt === undefined
          );
        }
        // Deleting a conversation only hides your own copy: a write may touch
        // your own clearedAt entry and no one else's.
        const was = (before?.clearedAt ?? {}) as Data;
        const is = (after.clearedAt ?? {}) as Data;
        return (
          deepEqual(before?.uids, uids) &&
          changedKeys(was, is).every((k) => k === uid) &&
          JSON.stringify(after).length < 4000
        );
      }
      if (p.length === 4 && p[2] === "messages") {
        return (
          action === "create" &&
          !!after &&
          onlyKeys(after, ["from", "text", "at"]) &&
          after.from === uid &&
          isString(after.text, 1000, 1) &&
          isNow(after.at, ctx)
        );
      }
      return false;
    }

    // adminChats/{uid} -> a member's private line to the admins.
    // notes/{id} -> { from: 'user' | 'admin', text, at }. `from` is a role, so
    // a reply reads as coming from the admins whichever account sent it, and a
    // member can never author the admin side of their own chat.
    //
    // Replying is deliberately plain admin, not fresh admin: answering a note
    // should not need the password again.
    case "adminChats": {
      if (p.length === 2) {
        if (action === "delete" || !after || after.uid !== p[1]) return false;
        if (admin) return true;
        if (p[1] !== uid) return false;
        const nameOk =
          after.username === ownUsername(ctx) || (!!before && after.username === before.username);
        // A member keeps their own read pointer, never the admins'.
        const seenOk = before
          ? deepEqual(after.adminSeenAt ?? null, before.adminSeenAt ?? null)
          : after.adminSeenAt === undefined;
        return nameOk && seenOk && JSON.stringify(after).length < 4000;
      }
      if (p.length === 4 && p[2] === "notes") {
        return (
          action === "create" &&
          !!after &&
          onlyKeys(after, ["from", "text", "at"]) &&
          isString(after.text, 1000, 1) &&
          isNow(after.at, ctx) &&
          ((p[1] === uid && after.from === "user") || (admin && after.from === "admin"))
        );
      }
      return false;
    }

    // photos/{id} -> { userUUID, username, imagePath, caption, timestamp,
    //                  likedBy, imageWidth, imageHeight, capturedAt }
    case "photos": {
      if (p.length === 2) {
        if (action === "delete") return before?.userUUID === uid || fresh;
        if (!after) return false;
        if (action === "create") {
          const captured = millis(after.capturedAt);
          return (
            notMuted(ctx) &&
            onlyKeys(after, [
              "userUUID", "username", "imagePath", "caption", "timestamp", "likedBy",
              "imageWidth", "imageHeight", "capturedAt",
            ]) &&
            after.userUUID === uid &&
            after.username === ownUsername(ctx) &&
            isString(after.imagePath, 200, 1) &&
            after.imagePath.startsWith(`photos/${uid}/`) &&
            isString(after.caption, 70) &&
            deepEqual(after.likedBy, []) &&
            isNow(after.timestamp, ctx) &&
            (after.imageWidth === undefined || typeof after.imageWidth === "number") &&
            (after.imageHeight === undefined || typeof after.imageHeight === "number") &&
            // When the camera was opened, by the poster's clock. Only a sanity
            // bound: the badge logic ignores stamps far from the upload time.
            (after.capturedAt === undefined ||
              (captured !== null && Math.abs(captured - now) < 86_400_000))
          );
        }
        if (!before) return false;
        if (fresh) return true;
        const mine = before.userUUID === uid;
        // Owner: restamp their username after a rename.
        if (mine && touchesOnly(before, after, ["username"])) {
          return after.username === ownUsername(ctx);
        }
        // Owner: edit the caption.
        if (mine && touchesOnly(before, after, ["caption"])) return isString(after.caption, 70);
        // Owner: soft delete. Recovery is an admin action.
        if (mine && touchesOnly(before, after, ["deleted", "deletedAt"])) {
          return after.deleted === true && isNow(after.deletedAt, ctx);
        }
        return ownLikeToggle(before, after, ctx);
      }
      if (p.length === 4 && p[2] === "comments") {
        if (action === "delete") return before?.userUUID === uid || fresh;
        if (!after) return false;
        if (action === "create") {
          return (
            notMuted(ctx) &&
            !!getDoc(`photos/${p[1]}`) &&
            onlyKeys(after, ["userUUID", "username", "text", "timestamp", "likedBy"]) &&
            after.userUUID === uid &&
            after.username === ownUsername(ctx) &&
            isNow(after.timestamp, ctx) &&
            deepEqual(after.likedBy ?? [], []) &&
            isString(after.text, 200, 1)
          );
        }
        if (!before) return false;
        if (fresh) return true;
        if (before.userUUID === uid && touchesOnly(before, after, ["username"])) {
          return after.username === ownUsername(ctx);
        }
        return ownLikeToggle(before, after, ctx);
      }
      return false;
    }

    // feedback/{id} -> notes to the admins, written from settings.
    case "feedback": {
      if (p.length !== 2) return false;
      if (action === "delete") return fresh;
      return (
        action === "create" &&
        !!after &&
        onlyKeys(after, ["uid", "username", "text", "at"]) &&
        after.uid === uid &&
        after.username === ownUsername(ctx) &&
        isString(after.text, 2000, 1) &&
        isNow(after.at, ctx)
      );
    }

    // claims/{id} -> a member's request to be credited for an unattributed
    // post. Immutable once filed; approving or declining it is an admin action.
    case "claims": {
      if (p.length !== 2) return false;
      if (action === "delete") return fresh;
      return (
        action === "create" &&
        !!after &&
        onlyKeys(after, ["postId", "uid", "username", "at"]) &&
        after.uid === uid &&
        after.username === ownUsername(ctx) &&
        isString(after.postId, 120, 1) &&
        isNow(after.at, ctx)
      );
    }

    default:
      return false;
  }
}
