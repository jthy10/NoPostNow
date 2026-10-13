import crypto from "node:crypto";
import type { Db } from "./db.ts";

// Accounts, passwords, invites and reset links. Shared by the web server and
// the command-line tools, so a host can always create or rescue an account
// from the machine itself without the site being reachable.

export type Account = {
  uid: string;
  email: string;
  role: "admin" | "member";
  disabled: boolean;
  totpEnabled: boolean;
  createdAt: number;
};

type AccountRow = {
  uid: string;
  email: string;
  pass_hash: string;
  role: string;
  disabled: number;
  totp_secret: string | null;
  totp_enabled: number;
  created_at: number;
};

export const MIN_PASSWORD_LENGTH = 8;
const USERNAME_MIN = 2;
const USERNAME_MAX = 24;

function toAccount(row: AccountRow): Account {
  return {
    uid: row.uid,
    email: row.email,
    role: row.role === "admin" ? "admin" : "member",
    disabled: row.disabled === 1,
    totpEnabled: row.totp_enabled === 1,
    createdAt: row.created_at,
  };
}

// Document ids and uids: URL-safe, and never containing "_" — DM thread ids
// are two uids joined with one, and membership is read straight off the id.
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// scrypt with a per-password salt. The cost parameters are stored with the
// hash so they can be raised later without invalidating existing passwords.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join(
    "$"
  );
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const N = Number(n);
  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
      N,
      r: Number(r),
      p: Number(p),
      maxmem: 128 * N * Number(r) * 2,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Spends the same effort as a real check. Used when the email is unknown, so
// response time doesn't reveal which addresses have accounts.
const DUMMY_HASH = hashPassword("nopostnow-timing-placeholder");

export function burnPasswordCheck(password: string) {
  verifyPassword(password, DUMMY_HASH);
}

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function validateEmail(email: string): string | null {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`;
  }
  if (password.length > 200) return "That password is too long.";
  return null;
}

// Mirrors the client-side rule in lib/settings.ts. Underscores are refused
// because @mentions and DM thread ids both treat them as separators.
export function validateUsername(name: unknown): string | null {
  if (typeof name !== "string") return "Pick a username.";
  const trimmed = name.trim();
  if (trimmed.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (trimmed.length > USERNAME_MAX) return `Username must be ${USERNAME_MAX} characters or fewer.`;
  if (trimmed.toLowerCase() === "anonymous") return "That name is reserved.";
  if (trimmed.includes("_")) return "Usernames can't contain underscores.";
  return null;
}

export function getAccount(db: Db, uid: string): Account | null {
  const row = db.prepare("SELECT * FROM accounts WHERE uid = ?").get(uid) as AccountRow | undefined;
  return row ? toAccount(row) : null;
}

export function getAccountByEmail(db: Db, email: string): Account | null {
  const row = db.prepare("SELECT * FROM accounts WHERE email = ?").get(normalizeEmail(email)) as
    | AccountRow
    | undefined;
  return row ? toAccount(row) : null;
}

export function listAccounts(db: Db): Account[] {
  return (db.prepare("SELECT * FROM accounts ORDER BY created_at").all() as AccountRow[]).map(
    toAccount
  );
}

export function countAccounts(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
}

export function checkPassword(db: Db, uid: string, password: string): boolean {
  const row = db.prepare("SELECT pass_hash FROM accounts WHERE uid = ?").get(uid) as
    | { pass_hash: string }
    | undefined;
  return !!row && verifyPassword(password, row.pass_hash);
}

export function usernameTaken(db: Db, username: string, exceptUid?: string): boolean {
  const wanted = username.trim().toLowerCase();
  const rows = db.prepare("SELECT id, data FROM docs WHERE parent = 'users'").all() as {
    id: string;
    data: string;
  }[];
  return rows.some((row) => {
    if (row.id === exceptUid) return false;
    const name = JSON.parse(row.data).username;
    return typeof name === "string" && name.trim().toLowerCase() === wanted;
  });
}

// Creates the login and the public profile together. The profile document is
// keyed by uid and never contains the email address, so members can look each
// other up without learning how anyone signs in.
export function createAccount(
  db: Db,
  opts: { email: string; password: string; username: string; role?: "admin" | "member" }
): Account {
  const email = normalizeEmail(opts.email);
  const problem =
    validateEmail(email) ?? validatePassword(opts.password) ?? validateUsername(opts.username);
  if (problem) throw new Error(problem);
  if (getAccountByEmail(db, email)) throw new Error("An account with that email already exists.");
  const username = opts.username.trim();
  if (usernameTaken(db, username)) throw new Error("That username is taken.");

  const uid = randomId(24);
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO accounts (uid, email, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(uid, email, hashPassword(opts.password), opts.role === "admin" ? "admin" : "member", now);
    db.prepare(
      "INSERT INTO docs (path, parent, coll, id, data, created_at, updated_at) VALUES (?, 'users', 'users', ?, ?, ?, ?)"
    ).run(
      `users/${uid}`,
      uid,
      JSON.stringify({ uid, username, joinedAt: { __ts: now }, createdAt: { __ts: now } }),
      now,
      now
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return getAccount(db, uid)!;
}

export function setPassword(db: Db, uid: string, password: string) {
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  db.prepare("UPDATE accounts SET pass_hash = ? WHERE uid = ?").run(hashPassword(password), uid);
}

export function setEmail(db: Db, uid: string, newEmail: string) {
  const email = normalizeEmail(newEmail);
  const problem = validateEmail(email);
  if (problem) throw new Error(problem);
  const existing = getAccountByEmail(db, email);
  if (existing && existing.uid !== uid) throw new Error("That email is already in use.");
  db.prepare("UPDATE accounts SET email = ? WHERE uid = ?").run(email, uid);
}

export function setRole(db: Db, uid: string, role: "admin" | "member") {
  db.prepare("UPDATE accounts SET role = ? WHERE uid = ?").run(role, uid);
}

export function setDisabled(db: Db, uid: string, disabled: boolean) {
  db.prepare("UPDATE accounts SET disabled = ? WHERE uid = ?").run(disabled ? 1 : 0, uid);
  if (disabled) db.prepare("DELETE FROM sessions WHERE uid = ?").run(uid);
}

export function deleteAccount(db: Db, uid: string) {
  db.prepare("DELETE FROM accounts WHERE uid = ?").run(uid);
}

export function countAdmins(db: Db): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND disabled = 0").get() as {
      n: number;
    }
  ).n;
}

// --- invites -------------------------------------------------------------

export type Invite = {
  code: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
};

export function createInvite(
  db: Db,
  opts: { createdBy: string; maxUses?: number; days?: number }
): Invite {
  const code = randomId(12);
  const now = Date.now();
  const maxUses = Math.min(Math.max(Math.trunc(opts.maxUses ?? 1), 1), 500);
  const days = Math.min(Math.max(Math.trunc(opts.days ?? 7), 1), 365);
  const expiresAt = now + days * 86_400_000;
  db.prepare(
    "INSERT INTO invites (code, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)"
  ).run(code, opts.createdBy, now, expiresAt, maxUses);
  return { code, createdAt: now, expiresAt, maxUses, uses: 0 };
}

type InviteRow = {
  code: string;
  created_at: number;
  expires_at: number;
  max_uses: number;
  uses: number;
};

export function listInvites(db: Db): Invite[] {
  return (
    db.prepare("SELECT * FROM invites ORDER BY created_at DESC").all() as InviteRow[]
  ).map((r) => ({
    code: r.code,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    maxUses: r.max_uses,
    uses: r.uses,
  }));
}

export function inviteUsable(db: Db, code: string): boolean {
  const row = db.prepare("SELECT * FROM invites WHERE code = ?").get(code) as InviteRow | undefined;
  return !!row && row.uses < row.max_uses && row.expires_at > Date.now();
}

// Spends one use. Returns false when the invite ran out in the meantime, so a
// race between two signups can't stretch a single-use link.
export function redeemInvite(db: Db, code: string): boolean {
  const result = db
    .prepare("UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses AND expires_at > ?")
    .run(code, Date.now());
  return result.changes === 1;
}

export function revokeInvite(db: Db, code: string) {
  db.prepare("DELETE FROM invites WHERE code = ?").run(code);
}

// --- password reset links --------------------------------------------------

// There is no mail server in a self-hosted install, so a reset is a one-time
// link the host creates and hands to the member themselves.
export function createResetToken(db: Db, uid: string, hours = 24): string {
  const token = randomToken();
  db.prepare("DELETE FROM resets WHERE uid = ? OR expires_at < ?").run(uid, Date.now());
  db.prepare("INSERT INTO resets (token_hash, uid, expires_at) VALUES (?, ?, ?)").run(
    hashToken(token),
    uid,
    Date.now() + hours * 3_600_000
  );
  return token;
}

export function resetTokenUid(db: Db, token: string): string | null {
  const row = db
    .prepare("SELECT uid FROM resets WHERE token_hash = ? AND expires_at > ?")
    .get(hashToken(token), Date.now()) as { uid: string } | undefined;
  return row?.uid ?? null;
}

export function consumeResetToken(db: Db, token: string, password: string): boolean {
  const uid = resetTokenUid(db, token);
  if (!uid) return false;
  setPassword(db, uid, password);
  db.prepare("DELETE FROM resets WHERE uid = ?").run(uid);
  // A reset means the old password may be compromised: end every session.
  db.prepare("DELETE FROM sessions WHERE uid = ?").run(uid);
  return true;
}
