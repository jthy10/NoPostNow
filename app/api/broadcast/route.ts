import { pushConfigured, sendPush } from "@/server/push";
import { config } from "@/server/runtime";
import { getSession, isFreshAdmin, isSameOrigin } from "@/server/session";

export const dynamic = "force-dynamic";

// Admin announcement: one push to every member's devices (or, as a test, only
// the admin's own). Needs a recently unlocked admin session.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isSameOrigin(request))) return Response.json({ error: "cross-site" }, { status: 403 });
  if (!isFreshAdmin(session)) {
    return Response.json({ error: "Unlock the admin console again to send this." }, { status: 403 });
  }
  if (!pushConfigured()) return Response.json({ error: "push not configured" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    message?: string;
    url?: string;
    test?: boolean;
  };
  const title = (body.title || config().siteName).trim().slice(0, 40);
  const message = (body.message || "").trim().slice(0, 160);
  if (!message) return Response.json({ error: "empty message" }, { status: 400 });
  const url = body.url && /^\/[^\s]*$/.test(body.url) ? body.url : "/";

  const result = await sendPush({
    kind: "post",
    ignorePrefs: true,
    to: body.test ? [session.account.uid] : undefined,
    payload: { title, body: message, url },
  });
  return Response.json(result);
}
