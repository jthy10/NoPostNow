import { cookies, headers } from "next/headers";
import { db } from "./runtime.ts";
import { getAccount, hashToken, randomToken, type Account } from "./core/accounts.ts";

// Cookie sessions. The browser holds a random token; the database holds only
// its hash, so a copy of the database cannot be replayed as a login.

export const SESSION_COOKIE = "npn_session";
// Over HTTPS the cookie carries the __Host- prefix, which browsers only accept
// from this exact host, so another site on a sibling subdomain cannot plant
// or overwrite it.
const SECURE_SESSION_COOKIE = "__Host-npn_session";
const SESSION_DAYS = 90;
const SESSION_MS = SESSION_DAYS * 86_400_000;
// Admin actions need the password to have been entered this recently.
export const FRESH_ADMIN_MS = 15 * 60 * 1000;

export type Session = {
  tokenHash: string;
  account: Account;
  // When the password was last entered on this session.
  authAt: number;
  // Whether this session passed the second factor.
  mfa: boolean;
};

type SessionRow = {
  token_hash: string;
  uid: string;
  last_seen: number;
  auth_at: number;
  mfa: number;
};

async function isSecureRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  return proto ? proto.split(",")[0].trim() === "https" : false;
}

export async function startSession(uid: string, opts: { mfa: boolean }) {
  const token = randomToken();
  const now = Date.now();
  db()
    .prepare(
      "INSERT INTO sessions (token_hash, uid, created_at, last_seen, auth_at, mfa) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(hashToken(token), uid, now, now, now, opts.mfa ? 1 : 0);
  db().prepare("DELETE FROM sessions WHERE last_seen < ?").run(now - SESSION_MS);
  const secure = await isSecureRequest();
  (await cookies()).set(secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

// The prefixed cookie is the only one honoured over HTTPS, so a plain cookie
// set by some other means can never stand in for it.
async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return (await isSecureRequest())
    ? jar.get(SECURE_SESSION_COOKIE)?.value
    : jar.get(SESSION_COOKIE)?.value;
}

export async function getSession(): Promise<Session | null> {
  const token = await sessionToken();
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as
    | SessionRow
    | undefined;
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_seen > SESSION_MS) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  const account = getAccount(db(), row.uid);
  if (!account || account.disabled) return null;
  // Sliding expiry, written at most once an hour.
  if (now - row.last_seen > 3_600_000) {
    db().prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(now, tokenHash);
  }
  return { tokenHash, account, authAt: row.auth_at, mfa: row.mfa === 1 };
}

export async function endSession() {
  const jar = await cookies();
  const token = await sessionToken();
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  jar.delete(SESSION_COOKIE);
  if (await isSecureRequest()) {
    jar.set(SECURE_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
  }
}

export function endOtherSessions(uid: string, keepTokenHash: string) {
  db().prepare("DELETE FROM sessions WHERE uid = ? AND token_hash <> ?").run(uid, keepTokenHash);
}

// Called after the password (and second factor, when enrolled) is re-entered.
export function markReauthenticated(tokenHash: string, mfa: boolean) {
  db()
    .prepare("UPDATE sessions SET auth_at = ?, mfa = ? WHERE token_hash = ?")
    .run(Date.now(), mfa ? 1 : 0, tokenHash);
}

export function isAdmin(session: Session | null): boolean {
  return session?.account.role === "admin";
}

// Destructive admin actions need a recently entered password, plus the second
// factor when the admin has one enrolled. A stolen long-lived session can
// browse but cannot delete, mute or rename anything.
export function isFreshAdmin(session: Session | null): boolean {
  if (!session || session.account.role !== "admin") return false;
  if (Date.now() - session.authAt > FRESH_ADMIN_MS) return false;
  return session.account.totpEnabled ? session.mfa : true;
}

// Cookies are sent automatically, so every state-changing request must prove
// it came from this site: browsers always attach Origin to cross-site POSTs,
// and a custom header cannot be set by a plain HTML form.
export async function isSameOrigin(request: Request): Promise<boolean> {
  if (request.headers.get("x-nopostnow") !== "1") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// --- sign-in throttling ----------------------------------------------------

const attempts = new Map<string, number[]>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_MAX = 10;

export function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  attempts.set(key, recent);
  if (attempts.size > 5000) {
    for (const [k, times] of attempts) {
      if (!times.some((t) => now - t < ATTEMPT_WINDOW_MS)) attempts.delete(k);
    }
  }
  return recent.length >= ATTEMPT_MAX;
}

export function recordAttempt(key: string) {
  attempts.set(key, [...(attempts.get(key) ?? []), Date.now()]);
}

export function clearAttempts(key: string) {
  attempts.delete(key);
}

export async function clientKey(suffix: string): Promise<string> {
  const h = await headers();
  const ip =
    h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  return `${ip}|${suffix}`;
}
