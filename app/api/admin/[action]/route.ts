import {
  countAdmins,
  createInvite,
  createResetToken,
  getAccount,
  listAccounts,
  listInvites,
  revokeInvite,
  setDisabled,
  setRole,
} from "@/server/core/accounts";
import { isValidTimeZone, normalizeConfig } from "@/server/core/config";
import { eraseMember } from "@/server/members";
import { config, db, saveConfig } from "@/server/runtime";
import { getSession, isAdmin, isFreshAdmin, isSameOrigin } from "@/server/session";
import { siteOrigin } from "@/server/site";

export const dynamic = "force-dynamic";

// Things only the people running the site can do: see who has an account,
// invite people, hand out password reset links, and change the site itself.
// Reading needs an admin session; changing anything needs one that was
// unlocked with the password in the last few minutes.

function fail(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

function editableSite() {
  const c = config();
  return {
    siteName: c.siteName,
    tagline: c.tagline,
    accent: c.accent,
    publicUrl: c.publicUrl,
    signup: c.signup,
    timeZone: c.timeZone,
    dailyMoment: c.dailyMoment,
    pushReady: Boolean(c.vapid.publicKey && c.vapid.privateKey),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ action: string }> }) {
  const session = await getSession();
  if (!session) return fail(401, "unauthenticated", "Sign in again.");
  if (!isAdmin(session)) return fail(403, "permission-denied", "Admins only.");
  const { action } = await params;

  if (action === "accounts") return Response.json({ accounts: listAccounts(db()) });
  if (action === "invites") {
    return Response.json({ invites: listInvites(db()), origin: await siteOrigin() });
  }
  if (action === "site") return Response.json({ site: editableSite() });
  return fail(404, "unknown-action", "Unknown action.");
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const session = await getSession();
  if (!session) return fail(401, "unauthenticated", "Sign in again.");
  if (!(await isSameOrigin(request))) return fail(403, "cross-site", "Cross-site request refused.");
  if (!isFreshAdmin(session)) {
    return fail(403, "permission-denied", "Unlock the admin console again to do that.");
  }
  const { action } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const targetUid = typeof body.uid === "string" ? body.uid : "";

  if (action === "invite-create") {
    const invite = createInvite(db(), {
      createdBy: session.account.uid,
      maxUses: Number(body.maxUses) || 1,
      days: Number(body.days) || 7,
    });
    return Response.json({
      invite,
      url: `${await siteOrigin()}/login?invite=${invite.code}`,
    });
  }

  if (action === "invite-revoke") {
    revokeInvite(db(), String(body.code ?? ""));
    return Response.json({ ok: true });
  }

  if (action === "site") {
    const current = config();
    const next = normalizeConfig({ ...current, ...(body.site as object) });
    const requested = (body.site ?? {}) as { timeZone?: unknown };
    if (typeof requested.timeZone === "string" && !isValidTimeZone(requested.timeZone)) {
      return fail(400, "invalid", "That time zone isn't recognised — use a name like America/Chicago.");
    }
    // Only presentation and policy are editable from the browser. Where the
    // server listens and its push keys are set on the machine itself.
    saveConfig({
      ...current,
      siteName: next.siteName,
      tagline: next.tagline,
      accent: next.accent,
      publicUrl: next.publicUrl,
      signup: next.signup,
      timeZone: next.timeZone,
      dailyMoment: next.dailyMoment,
    });
    return Response.json({ site: editableSite() });
  }

  // Everything below acts on one member.
  const target = getAccount(db(), targetUid);
  if (!target) return fail(404, "not-found", "No such member.");
  const lastAdmin = target.role === "admin" && !target.disabled && countAdmins(db()) <= 1;

  if (action === "reset-link") {
    const token = createResetToken(db(), target.uid);
    return Response.json({ url: `${await siteOrigin()}/login?reset=${token}` });
  }

  if (action === "set-role") {
    const role = body.role === "admin" ? "admin" : "member";
    if (role === "member" && lastAdmin) {
      return fail(400, "last-admin", "This is the only admin — promote someone else first.");
    }
    setRole(db(), target.uid, role);
    return Response.json({ ok: true });
  }

  if (action === "set-disabled") {
    const disabled = body.disabled === true;
    if (disabled && lastAdmin) {
      return fail(400, "last-admin", "This is the only admin — promote someone else first.");
    }
    setDisabled(db(), target.uid, disabled);
    return Response.json({ ok: true });
  }

  if (action === "remove-member") {
    if (target.uid === session.account.uid) {
      return fail(400, "self", "Delete your own account from Settings instead.");
    }
    if (lastAdmin) return fail(400, "last-admin", "This is the only admin — promote someone else first.");
    eraseMember(target.uid);
    return Response.json({ ok: true });
  }

  return fail(404, "unknown-action", "Unknown action.");
}
