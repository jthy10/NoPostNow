import {
  burnPasswordCheck,
  checkPassword,
  consumeResetToken,
  countAdmins,
  createAccount,
  deleteAccount,
  getAccount,
  getAccountByEmail,
  inviteUsable,
  normalizeEmail,
  redeemInvite,
  resetTokenUid,
  setEmail,
  setPassword,
  validatePassword,
} from "@/server/core/accounts";
import { generateTotpSecret, totpUri, verifyTotp } from "@/server/core/totp";
import { config, db } from "@/server/runtime";
import { eraseMember } from "@/server/members";
import {
  clearAttempts,
  clientKey,
  endOtherSessions,
  endSession,
  FRESH_ADMIN_MS,
  getSession,
  isFreshAdmin,
  isSameOrigin,
  markReauthenticated,
  recordAttempt,
  startSession,
  tooManyAttempts,
} from "@/server/session";
import { sessionPayload } from "@/server/profile";
import { announce, removeDoc } from "@/server/store";

export const dynamic = "force-dynamic";

function fail(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

function totpSecretOf(uid: string): string | null {
  const row = db().prepare("SELECT totp_secret FROM accounts WHERE uid = ?").get(uid) as
    | { totp_secret: string | null }
    | undefined;
  return row?.totp_secret ?? null;
}

// Checks a second-factor code for an account that has one enrolled. Accounts
// without one pass, and the result says whether a factor was actually proven.
function secondFactor(uid: string, code: unknown): "ok" | "none" | "required" | "wrong" {
  const account = getAccount(db(), uid);
  const secret = totpSecretOf(uid);
  if (!account?.totpEnabled || !secret) return "none";
  if (typeof code !== "string" || !code) return "required";
  return verifyTotp(secret, code) ? "ok" : "wrong";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  if (!(await isSameOrigin(request))) return fail(403, "cross-site", "Cross-site request refused.");
  const { action } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad-json", "Malformed request.");
  }
  if (!body || typeof body !== "object") return fail(400, "bad-json", "Malformed request.");
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");

  // --- signed-out actions ---------------------------------------------------

  if (action === "login") {
    const email = normalizeEmail(body.email);
    const keys = [await clientKey("login"), `account|${email}`];
    if (keys.some(tooManyAttempts)) {
      return fail(429, "too-many-requests", "Too many attempts — wait a few minutes and try again.");
    }
    const account = getAccountByEmail(db(), email);
    // The password is checked even for unknown emails, so the response time
    // doesn't reveal which addresses have accounts.
    const ok = account
      ? checkPassword(db(), account.uid, text("password"))
      : (burnPasswordCheck(text("password")), false);
    if (!account || !ok || account.disabled) {
      keys.forEach(recordAttempt);
      return fail(401, "invalid-credential", "Wrong email or password.");
    }
    const factor = secondFactor(account.uid, body.code);
    if (factor === "required") return fail(401, "mfa-required", "Enter your authenticator code.");
    if (factor === "wrong") {
      keys.forEach(recordAttempt);
      return fail(401, "mfa-wrong", "Wrong code — check your authenticator app and try again.");
    }
    keys.forEach(clearAttempts);
    await startSession(account.uid, { mfa: factor === "ok" });
    return Response.json(sessionPayload(account));
  }

  if (action === "signup") {
    const mode = config().signup;
    const invite = text("invite").trim();
    if (mode === "closed") return fail(403, "signup-closed", "Sign-ups are closed on this site.");
    if (mode === "invite" && !inviteUsable(db(), invite)) {
      return fail(403, "invite-invalid", "That invite link is not valid any more — ask for a new one.");
    }
    if (tooManyAttempts(await clientKey("signup"))) {
      return fail(429, "too-many-requests", "Too many attempts — wait a few minutes and try again.");
    }
    recordAttempt(await clientKey("signup"));
    let account;
    try {
      account = createAccount(db(), {
        email: text("email"),
        password: text("password"),
        username: text("username"),
      });
    } catch (err) {
      return fail(400, "invalid", err instanceof Error ? err.message : "Could not create the account.");
    }
    if (mode === "invite" && !redeemInvite(db(), invite)) {
      deleteAccount(db(), account.uid);
      removeDoc(`users/${account.uid}`);
      return fail(403, "invite-invalid", "That invite link was just used up — ask for a new one.");
    }
    announce({ parent: "users", path: `users/${account.uid}`, data: {} });
    await startSession(account.uid, { mfa: false });
    return Response.json(sessionPayload(account));
  }

  if (action === "logout") {
    await endSession();
    return Response.json({ ok: true });
  }

  if (action === "invite-check") {
    return Response.json({ valid: inviteUsable(db(), text("invite").trim()) });
  }

  if (action === "reset-check") {
    return Response.json({ valid: resetTokenUid(db(), text("token")) !== null });
  }

  if (action === "reset") {
    const problem = validatePassword(body.password);
    if (problem) return fail(400, "weak-password", problem);
    if (!consumeResetToken(db(), text("token"), text("password"))) {
      return fail(400, "reset-invalid", "That reset link has expired — ask for a new one.");
    }
    return Response.json({ ok: true });
  }

  // --- signed-in actions ----------------------------------------------------

  const session = await getSession();
  if (!session) return fail(401, "unauthenticated", "Sign in again.");
  const { uid } = session.account;

  // Everything below changes the account itself, so the current password is
  // asked for every time rather than trusting the session alone. The one
  // exception is setting up an authenticator right after the password was
  // entered (the admin console does this straight after unlocking).
  const key = `reauth|${uid}`;
  const recentPassword = Date.now() - session.authAt < FRESH_ADMIN_MS;
  const enrolling = action === "totp-begin" || action === "totp-confirm";
  if (!(enrolling && recentPassword)) {
    if (tooManyAttempts(key)) {
      return fail(429, "too-many-requests", "Too many attempts — wait a few minutes and try again.");
    }
    if (!checkPassword(db(), uid, text("password"))) {
      recordAttempt(key);
      return fail(401, "invalid-credential", "Wrong password.");
    }
  }

  if (action === "reauth") {
    const factor = secondFactor(uid, body.code);
    if (factor === "required") return fail(401, "mfa-required", "Enter your authenticator code.");
    if (factor === "wrong") {
      recordAttempt(key);
      return fail(401, "mfa-wrong", "Wrong code — check your authenticator app and try again.");
    }
    clearAttempts(key);
    markReauthenticated(session.tokenHash, factor === "ok");
    return Response.json({ ok: true, freshAdmin: isFreshAdmin((await getSession())!) });
  }

  if (action === "password") {
    try {
      setPassword(db(), uid, text("newPassword"));
    } catch (err) {
      return fail(400, "weak-password", err instanceof Error ? err.message : "Invalid password.");
    }
    endOtherSessions(uid, session.tokenHash);
    return Response.json({ ok: true });
  }

  if (action === "email") {
    try {
      setEmail(db(), uid, text("newEmail"));
    } catch (err) {
      return fail(400, "invalid-email", err instanceof Error ? err.message : "Invalid email.");
    }
    endOtherSessions(uid, session.tokenHash);
    return Response.json({ ok: true, email: normalizeEmail(body.newEmail) });
  }

  if (action === "totp-begin") {
    const secret = generateTotpSecret();
    db()
      .prepare("UPDATE accounts SET totp_secret = ?, totp_enabled = 0 WHERE uid = ? AND totp_enabled = 0")
      .run(secret, uid);
    if (getAccount(db(), uid)?.totpEnabled) {
      return fail(400, "totp-enrolled", "An authenticator is already set up.");
    }
    return Response.json({
      secret,
      uri: totpUri(secret, session.account.email, config().siteName),
    });
  }

  if (action === "totp-confirm") {
    const secret = totpSecretOf(uid);
    if (!secret || !verifyTotp(secret, text("code"))) {
      return fail(400, "mfa-wrong", "Wrong code — check your authenticator app and try again.");
    }
    db().prepare("UPDATE accounts SET totp_enabled = 1 WHERE uid = ?").run(uid);
    markReauthenticated(session.tokenHash, true);
    endOtherSessions(uid, session.tokenHash);
    return Response.json({ ok: true });
  }

  if (action === "totp-disable") {
    const factor = secondFactor(uid, body.code);
    if (factor === "required" || factor === "wrong") {
      if (factor === "wrong") recordAttempt(key);
      return fail(401, "mfa-wrong", "Enter a current code from your authenticator app.");
    }
    clearAttempts(key);
    db().prepare("UPDATE accounts SET totp_enabled = 0, totp_secret = NULL WHERE uid = ?").run(uid);
    return Response.json({ ok: true });
  }

  if (action === "delete-account") {
    if (session.account.role === "admin" && countAdmins(db()) <= 1) {
      return fail(400, "last-admin", "Make another member an admin before deleting the only admin account.");
    }
    eraseMember(uid);
    await endSession();
    return Response.json({ ok: true });
  }

  return fail(404, "unknown-action", "Unknown action.");
}
