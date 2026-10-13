#!/usr/bin/env node
// Account management from the machine the site runs on. This always works,
// even when the site itself is unreachable or every admin is locked out.
//
//   npm run users -- list
//   npm run users -- create            (asks for the details)
//   npm run users -- reset <email>     (prints a one-time password reset link)
//   npm run users -- admin <email>     (make someone an admin)
//   npm run users -- member <email>    (remove admin)
//   npm run users -- disable <email> | enable <email>
//   npm run users -- invite [uses] [days]
import {
  countAdmins,
  createAccount,
  createInvite,
  createResetToken,
  getAccountByEmail,
  listAccounts,
  setDisabled,
  setRole,
  validateEmail,
  validatePassword,
  validateUsername,
  normalizeEmail,
} from "../server/core/accounts.ts";
import { ask, bold, closePrompts, confirm, dim, green, openInstance, red } from "./lib.mjs";

const [command = "help", ...args] = process.argv.slice(2);
const { db, config, dataDir } = openInstance();
const origin = config.publicUrl || `http://localhost:${config.port}`;

function need(email) {
  const account = email && getAccountByEmail(db, email);
  if (!account) {
    console.error(red(email ? `No account with the email ${email}.` : "Give the member's email address."));
    process.exit(1);
  }
  return account;
}

function usernameOf(uid) {
  const row = db.prepare("SELECT data FROM docs WHERE path = ?").get(`users/${uid}`);
  return row ? JSON.parse(row.data).username : "?";
}

try {
  if (command === "list") {
    const accounts = listAccounts(db);
    if (accounts.length === 0) console.log("No accounts yet. Create one with: npm run users -- create");
    for (const a of accounts) {
      const tags = [a.role === "admin" && "admin", a.disabled && "locked out", a.totpEnabled && "2FA"]
        .filter(Boolean)
        .join(", ");
      console.log(`${bold(usernameOf(a.uid).padEnd(24))} ${a.email}${tags ? dim(`  (${tags})`) : ""}`);
    }
  } else if (command === "create") {
    const email = await ask("Email", { check: (v) => validateEmail(normalizeEmail(v)) ?? (getAccountByEmail(db, v) ? "That email already has an account." : null) });
    const username = await ask("Username", { check: validateUsername });
    const password = await ask("Password", { secret: true, check: validatePassword });
    const admin = await confirm("Make this account an admin?", countAdmins(db) === 0);
    createAccount(db, { email, username, password, role: admin ? "admin" : "member" });
    console.log(green(`Created ${username} (${admin ? "admin" : "member"}).`));
  } else if (command === "reset") {
    const account = need(args[0]);
    console.log(`Send this link to ${usernameOf(account.uid)}. It works once and expires in 24 hours:\n`);
    console.log(`  ${origin}/login?reset=${createResetToken(db, account.uid)}\n`);
  } else if (command === "admin" || command === "member") {
    const account = need(args[0]);
    if (command === "member" && account.role === "admin" && countAdmins(db) <= 1) {
      throw new Error("That is the only admin — make someone else an admin first.");
    }
    setRole(db, account.uid, command);
    console.log(green(`${usernameOf(account.uid)} is now ${command === "admin" ? "an admin" : "a regular member"}.`));
  } else if (command === "disable" || command === "enable") {
    const account = need(args[0]);
    setDisabled(db, account.uid, command === "disable");
    console.log(green(`${usernameOf(account.uid)} ${command === "disable" ? "is locked out" : "can sign in again"}.`));
  } else if (command === "invite") {
    const invite = createInvite(db, { createdBy: "cli", maxUses: Number(args[0]) || 1, days: Number(args[1]) || 7 });
    console.log(`Invite link (${invite.maxUses} use${invite.maxUses === 1 ? "" : "s"}):\n`);
    console.log(`  ${origin}/login?invite=${invite.code}\n`);
  } else {
    console.log(`Data folder: ${dataDir}

  npm run users -- list
  npm run users -- create
  npm run users -- reset <email>      one-time password reset link
  npm run users -- invite [uses] [days]
  npm run users -- admin <email>      make an admin
  npm run users -- member <email>     remove admin
  npm run users -- disable <email>    lock someone out
  npm run users -- enable <email>`);
  }
} catch (err) {
  console.error(red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  closePrompts();
  db.close();
}
