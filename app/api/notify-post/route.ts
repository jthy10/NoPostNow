import { listAccounts } from "@/server/core/accounts";
import { blockedPairUids, pushConfigured, sendPush, type PushKind } from "@/server/push";
import { config, db } from "@/server/runtime";
import { getSession, isAdmin, isSameOrigin } from "@/server/session";
import { getDoc } from "@/server/store";

export const dynamic = "force-dynamic";

// Fans out push notifications: new posts go to everyone, comments and likes
// go only to the people involved. The actor's own devices never ring, and
// neither do the devices of anyone blocked in either direction.
//
// Nothing in the request body is trusted for *identity*: the sender is the
// signed-in member, their display name is read from their own profile, and a
// DM ping must name a thread the sender actually belongs to. The body only
// says what happened, never who.

// Per-member ceiling on how many notifications one person can trigger — a
// backstop against a runaway client or a spam burst.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const recentSends = new Map<string, number[]>();

function rateLimited(uid: string): boolean {
  const now = Date.now();
  const recent = (recentSends.get(uid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  recentSends.set(uid, recent);
  if (recentSends.size > 200) {
    for (const [key, times] of recentSends) {
      if (!times.some((t) => now - t < RATE_WINDOW_MS)) recentSends.delete(key);
    }
  }
  return recent.length > RATE_MAX;
}

const TYPES = [
  "post", "comment", "like", "dm", "mention", "commentLike", "adminNote", "adminReply",
] as const;
type NotifyType = (typeof TYPES)[number];

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isSameOrigin(request))) return Response.json({ error: "cross-site" }, { status: 403 });
  if (!pushConfigured()) return Response.json({ sent: 0, stale: 0, skipped: "push not configured" });

  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    caption?: string;
    text?: string;
    targetUid?: string;
    targetUids?: string[];
    postId?: string;
    threadId?: string;
  };
  const type: NotifyType = TYPES.includes(body.type as NotifyType) ? (body.type as NotifyType) : "post";
  const actorUid = session.account.uid;
  const profile = getDoc(`users/${actorUid}`)?.data;

  let uids = [
    ...new Set(
      (Array.isArray(body.targetUids) ? body.targetUids : body.targetUid ? [body.targetUid] : [])
        .filter((u): u is string => typeof u === "string" && u.length > 0)
    ),
  ].slice(0, 30);

  if (type === "adminNote") {
    // A member's note rings every admin.
    uids = listAccounts(db()).filter((a) => a.role === "admin" && !a.disabled).map((a) => a.uid);
  } else if (type === "adminReply" && !isAdmin(session)) {
    return Response.json({ error: "not an admin" }, { status: 403 });
  }
  if (type !== "post" && uids.length === 0) {
    return Response.json({ sent: 0, stale: 0, skipped: "no targets" });
  }

  const idOk = (s?: string) => (s && /^[A-Za-z0-9_-]{1,120}$/.test(s) ? s : null);
  const postId = idOk(body.postId);
  const threadId = idOk(body.threadId);

  // A "new post" ping reaches everyone, so it must be about a post the
  // sender really made.
  if (type === "post" && (!postId || getDoc(`photos/${postId}`)?.data.userUUID !== actorUid)) {
    return Response.json({ error: "not your post" }, { status: 403 });
  }
  // A DM ping must name a thread the sender is in, and only its members.
  if (type === "dm") {
    const parts = threadId ? threadId.split("_") : [];
    const inThread = (u: string) => parts.includes(u);
    if (parts.length !== 2 || !inThread(actorUid) || !uids.every(inThread)) {
      return Response.json({ error: "not a participant" }, { status: 403 });
    }
  }
  // Muted members can't push text at people.
  if (profile?.muted === true && type !== "like" && type !== "commentLike" && type !== "adminNote") {
    return Response.json({ sent: 0, stale: 0, skipped: "muted" });
  }
  if (rateLimited(actorUid)) return Response.json({ error: "slow down" }, { status: 429 });

  const { siteName } = config();
  const username =
    type === "adminReply"
      ? `${siteName} Admin`
      : (typeof profile?.username === "string" ? profile.username : "Someone").slice(0, 30);
  const caption = (body.caption || "").trim().slice(0, 70);
  const text = (body.text || "").trim().slice(0, 90);
  const messages: Record<NotifyType, string> = {
    post: caption ? `${username} just posted — “${caption}”` : `${username} just posted`,
    comment: text ? `${username} commented: “${text}”` : `${username} commented on a post`,
    like: `${username} liked your photo`,
    dm: text ? `${username}: ${text}` : `New message from ${username}`,
    mention: text ? `${username} mentioned you: “${text}”` : `${username} mentioned you`,
    commentLike: `${username} liked your comment`,
    adminNote: text ? `${username} left a note: “${text}”` : `${username} left a note`,
    adminReply: text ? `${username}: ${text}` : `New message from ${username}`,
  };
  // A mention rides the comment preference and a comment-like the like one, so
  // "mute comments" and "mute likes" each do what they say.
  const kind: PushKind =
    type === "mention"
      ? "comment"
      : type === "commentLike"
        ? "like"
        : type === "adminNote" || type === "adminReply"
          ? "dm"
          : type;
  const opensThread = type === "comment" || type === "mention" || type === "commentLike";
  const adminChat = type === "adminNote" || type === "adminReply";
  const url = adminChat
    ? "/dm/admins"
    : type === "dm"
      ? `/dm/${threadId}`
      : postId
        ? `/p/${postId}${opensThread ? "?comments=1" : ""}`
        : "/";

  const exclude = blockedPairUids(actorUid);
  exclude.add(actorUid);
  const result = await sendPush({
    kind,
    to: type === "post" ? undefined : uids,
    exclude,
    payload: {
      title: siteName,
      body: messages[type],
      url,
      // A burst of messages in one thread collapses into one notification.
      ...(type === "dm" ? { tag: `dm-${threadId}` } : {}),
      ...(adminChat ? { tag: type === "adminNote" ? `admin-note-${actorUid}` : "admin-chat" } : {}),
    },
  });
  return Response.json(result);
}
