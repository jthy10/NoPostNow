// Unit tests for the parts shared by the server and the command-line tools.
// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  consumeResetToken,
  countAdmins,
  createAccount,
  createInvite,
  createResetToken,
  getAccountByEmail,
  hashPassword,
  inviteUsable,
  redeemInvite,
  validateUsername,
  verifyPassword,
  checkPassword,
} from "../server/core/accounts.ts";
import { normalizeConfig, readConfig, resolveDataDir, writeConfig, writePointer } from "../server/core/config.ts";
import { openDatabase } from "../server/core/db.ts";
import { currentTotp, generateTotpSecret, verifyTotp } from "../server/core/totp.ts";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nopostnow-test-"));
}

test("passwords hash and verify", () => {
  const hash = hashPassword("correct horse");
  assert.ok(verifyPassword("correct horse", hash));
  assert.ok(!verifyPassword("wrong horse", hash));
  assert.ok(!verifyPassword("anything", "not-a-hash"));
  assert.notEqual(hash, hashPassword("correct horse"), "each hash has its own salt");
});

test("usernames follow the house rules", () => {
  assert.equal(validateUsername("Sal"), null);
  assert.ok(validateUsername("a"));
  assert.ok(validateUsername("Anonymous"));
  assert.ok(validateUsername("under_score"));
  assert.ok(validateUsername("x".repeat(25)));
});

test("accounts, profiles and uniqueness", () => {
  const db = openDatabase(tempDir());
  const admin = createAccount(db, { email: "Host@Example.com", password: "long-enough", username: "Host", role: "admin" });
  assert.equal(admin.email, "host@example.com");
  assert.equal(countAdmins(db), 1);
  assert.ok(getAccountByEmail(db, "HOST@example.com"));
  assert.ok(checkPassword(db, admin.uid, "long-enough"));

  const profile = JSON.parse(db.prepare("SELECT data FROM docs WHERE path = ?").get(`users/${admin.uid}`).data);
  assert.equal(profile.username, "Host");
  assert.ok(!JSON.stringify(profile).includes("@"), "profiles never hold the email");

  assert.throws(() => createAccount(db, { email: "host@example.com", password: "long-enough", username: "Other" }));
  assert.throws(() => createAccount(db, { email: "b@example.com", password: "long-enough", username: "host" }));
  assert.throws(() => createAccount(db, { email: "c@example.com", password: "short", username: "Cee" }));
  assert.ok(!admin.uid.includes("_"), "uids never contain the thread-id separator");
  db.close();
});

test("invites run out", () => {
  const db = openDatabase(tempDir());
  const invite = createInvite(db, { createdBy: "test", maxUses: 2 });
  assert.ok(inviteUsable(db, invite.code));
  assert.ok(redeemInvite(db, invite.code));
  assert.ok(redeemInvite(db, invite.code));
  assert.ok(!redeemInvite(db, invite.code));
  assert.ok(!inviteUsable(db, invite.code));
  assert.ok(!inviteUsable(db, "nope"));
  db.close();
});

test("reset links work once and end sessions", () => {
  const db = openDatabase(tempDir());
  const account = createAccount(db, { email: "a@example.com", password: "old-password", username: "Aye" });
  db.prepare("INSERT INTO sessions (token_hash, uid, created_at, last_seen, auth_at) VALUES ('h', ?, 0, 0, 0)").run(account.uid);
  const token = createResetToken(db, account.uid);
  assert.ok(!consumeResetToken(db, "wrong", "new-password-1"));
  assert.ok(consumeResetToken(db, token, "new-password-1"));
  assert.ok(!consumeResetToken(db, token, "new-password-2"));
  assert.ok(checkPassword(db, account.uid, "new-password-1"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  db.close();
});

test("authenticator codes", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  assert.ok(verifyTotp(secret, currentTotp(secret, now), now));
  assert.ok(verifyTotp(secret, currentTotp(secret, now - 30_000), now), "one step of clock drift is fine");
  assert.ok(!verifyTotp(secret, currentTotp(secret, now - 300_000), now));
  assert.ok(!verifyTotp(secret, "abcdef", now));
  // RFC 6238 test vector (SHA-1, T = 59s).
  assert.equal(currentTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000), "287082");
});

test("config falls back field by field", () => {
  const config = normalizeConfig({
    siteName: "  Lake House  ",
    accent: "red",
    port: 99999,
    signup: "whatever",
    timeZone: "Mars/Olympus",
    dailyMoment: { enabled: true, time: "25:00", specialDate: "13-40" },
  });
  assert.equal(config.siteName, "Lake House");
  assert.equal(config.accent, "#ff3b5c");
  assert.equal(config.port, 3000);
  assert.equal(config.signup, "invite");
  assert.equal(config.timeZone, "America/New_York");
  assert.equal(config.dailyMoment.enabled, true);
  assert.equal(config.dailyMoment.time, "19:00");
  assert.equal(config.dailyMoment.specialDate, "");
});

test("config round-trips through the data folder", () => {
  const app = tempDir();
  const data = path.join(app, "elsewhere");
  writeConfig(data, normalizeConfig({ siteName: "Crew", port: 4321 }));
  writePointer(app, "elsewhere");
  const before = process.env.NOPOSTNOW_DATA_DIR;
  delete process.env.NOPOSTNOW_DATA_DIR;
  try {
    assert.equal(resolveDataDir(app), data);
  } finally {
    if (before !== undefined) process.env.NOPOSTNOW_DATA_DIR = before;
  }
  assert.equal(readConfig(data).port, 4321);
  assert.equal(readConfig(path.join(app, "missing")).siteName, "NoPostNow");
});
