#!/usr/bin/env node
// The setup wizard. Run it once to create a site, or again at any time to
// change its settings — existing answers are offered as the defaults and
// nothing already stored is touched.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  DEFAULT_CONFIG,
  hasConfig,
  isValidTimeZone,
  readConfig,
  resolveDataDir,
  writeConfig,
  writePointer,
} from "../server/core/config.ts";
import { openDatabase } from "../server/core/db.ts";
import {
  countAdmins,
  createAccount,
  getAccountByEmail,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateUsername,
} from "../server/core/accounts.ts";
import {
  appDir,
  ask,
  bold,
  choose,
  closePrompts,
  confirm,
  cyan,
  dim,
  green,
  red,
  yellow,
} from "./lib.mjs";
import { printGoingOnline } from "./online.mjs";

const TERMS = `
  Before you start, the short version of what you are agreeing to:

   1. NoPostNow is free, open-source software under the MIT License. It comes
      with no warranty. You run it at your own risk.
   2. You are the host. The photos, messages and accounts on your site live on
      your computer and are your responsibility — including keeping backups,
      keeping the machine secure, and deciding who gets an invite.
   3. You are responsible for what is shared on your site and for following
      the law where you and your members live. Do not use it to share illegal
      content or to harass anyone.
   4. The authors of NoPostNow do not operate your site, cannot see its
      contents, and cannot recover a lost password or a deleted photo for you.

  The full license is in the LICENSE file.
`;

const ACCENTS = [
  { label: "Rose", value: "#ff3b5c" },
  { label: "Orange", value: "#ff8a3d" },
  { label: "Gold", value: "#e0a82e" },
  { label: "Green", value: "#2ecc71" },
  { label: "Teal", value: "#22b8a8" },
  { label: "Blue", value: "#4c8dff" },
  { label: "Violet", value: "#9b6bff" },
  { label: "Pick my own (hex code)", value: "custom" },
];

function heading(step, title) {
  console.log(`\n${cyan(bold(`Step ${step}`))}  ${bold(title)}`);
}

function portFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const currentDataDir = resolveDataDir(appDir);
  const existing = hasConfig(currentDataDir);
  const before = existing ? readConfig(currentDataDir) : DEFAULT_CONFIG;

  console.log(`\n${bold("NoPostNow setup")}`);
  console.log(
    dim(
      existing
        ? "  This site is already set up. Press Enter to keep each current setting."
        : "  A private photo feed for you and your friends, running on this computer.\n  This takes about two minutes. Press Enter to accept the suggestion in [brackets]."
    )
  );

  // --- terms -----------------------------------------------------------------
  let termsAcceptedAt = before.termsAcceptedAt;
  if (!termsAcceptedAt) {
    heading(1, "Terms of use");
    console.log(TERMS);
    if (!(await confirm("Do you accept these terms?", false))) {
      console.log(red("\nSetup stopped — the terms were not accepted. Nothing was changed."));
      return 1;
    }
    termsAcceptedAt = new Date().toISOString();
  }

  // --- name and look ---------------------------------------------------------
  heading(2, "Name and look");
  const siteName = await ask("  What should your site be called?", {
    fallback: before.siteName,
    check: (v) => (v.length > 40 ? "Keep it to 40 characters or fewer." : null),
  });
  const tagline = await ask("  A short tagline for the login page", {
    fallback: before.tagline,
    check: (v) => (v.length > 120 ? "Keep it to 120 characters or fewer." : null),
  });
  const known = ACCENTS.findIndex((a) => a.value === before.accent);
  let accent = await choose(
    "  Accent colour (hearts, badges, highlights):",
    ACCENTS,
    known >= 0 ? known : ACCENTS.length - 1
  );
  if (accent === "custom") {
    accent = await ask("  Hex colour", {
      fallback: before.accent,
      check: (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? null : "Use the form #rrggbb, for example #ff3b5c."),
    });
  }

  // --- where the files live --------------------------------------------------
  heading(3, "Where your photos live");
  console.log(dim("  One folder holds everything: photos, accounts and settings. Back up this\n  folder and you have backed up your whole site."));
  const dataDir = path.resolve(
    appDir,
    await ask("  Data folder", {
      fallback: currentDataDir,
      check: (v) => (writable(path.resolve(appDir, v)) ? null : "Can't write to that folder — choose another."),
    })
  );
  if (existing && dataDir !== currentDataDir && !hasConfig(dataDir)) {
    console.log(
      yellow(`  Note: your existing data stays in ${currentDataDir}.\n  Move its contents to the new folder yourself if you want to keep it.`)
    );
  }

  // --- address and port ------------------------------------------------------
  heading(4, "Address and port");
  const ips = lanAddresses();
  const hostChoice = await choose(
    "  Who should be able to open the site directly?",
    [
      {
        label: "This computer and others on my network",
        hint: ips.length ? `e.g. http://${ips[0]}:port` : "all network interfaces",
        value: "0.0.0.0",
      },
      {
        label: "Only this computer",
        hint: "the safest choice when you'll use a Cloudflare Tunnel",
        value: "127.0.0.1",
      },
      { label: "A specific IP address on this machine", value: "custom" },
    ],
    before.host === "127.0.0.1" ? 1 : before.host === "0.0.0.0" ? 0 : 2
  );
  const host =
    hostChoice === "custom"
      ? await ask("  IP address to listen on", {
          fallback: before.host === "0.0.0.0" ? ips[0] ?? "127.0.0.1" : before.host,
          check: (v) => (net.isIP(v) ? null : "Enter an IP address, for example 192.168.1.20."),
        })
      : hostChoice;

  let port;
  for (;;) {
    port = Number(
      await ask("  Port", {
        fallback: String(before.port),
        check: (v) =>
          /^\d+$/.test(v) && +v >= 1 && +v <= 65535
            ? +v < 1024 && process.platform !== "win32" && process.getuid?.() !== 0
              ? "Ports below 1024 need administrator rights — pick one above 1024."
              : null
            : "Enter a port number between 1 and 65535.",
      })
    );
    if (await portFree(port, host)) break;
    if (await confirm(yellow(`  Port ${port} is in use right now (maybe by this site). Use it anyway?`), existing && port === before.port)) break;
  }

  const publicUrl = (
    await ask(`  Public address, if you already have one ${dim("(leave empty for now)")}`, {
      fallback: before.publicUrl,
      check: (v) => (!v || /^https?:\/\/[^\s/]+/.test(v) ? null : "Start with https:// — for example https://photos.example.com"),
    })
  ).replace(/\/+$/, "");

  // --- group rules -----------------------------------------------------------
  heading(5, "Your group");
  const signup = await choose(
    "  How do people join?",
    [
      { label: "With an invite link from you", hint: "recommended", value: "invite" },
      { label: "Anyone who finds the site can sign up", value: "open" },
      { label: "Nobody — I'll create every account myself", value: "closed" },
    ],
    ["invite", "open", "closed"].indexOf(before.signup)
  );
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timeZone = await ask("  Your group's time zone", {
    fallback: existing ? before.timeZone : systemZone,
    check: (v) => (isValidTimeZone(v) ? null : "Not a known zone — use a name like America/Chicago or Europe/London."),
  });
  console.log(dim("  Optional: a daily moment. Everyone gets a reminder at one time each day,\n  and photos posted on that exact minute earn a glowing badge."));
  const momentOn = await confirm("  Turn on a daily moment?", before.dailyMoment.enabled);
  let dailyMoment = { ...before.dailyMoment, enabled: momentOn };
  if (momentOn) {
    const time = await ask("  What time? (24-hour, HH:MM)", {
      fallback: before.dailyMoment.time,
      check: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : "Use 24-hour HH:MM, for example 19:30."),
    });
    dailyMoment = { ...dailyMoment, time };
  }

  // --- save ------------------------------------------------------------------
  // An existing data folder keeps its own keys: new ones would silently cut
  // off every device that has notifications turned on.
  let vapid = (hasConfig(dataDir) ? readConfig(dataDir) : before).vapid;
  if (!vapid.publicKey || !vapid.privateKey) {
    // Signing keys for push notifications, made once and kept in the data folder.
    const webpush = createRequire(import.meta.url)("web-push");
    const keys = webpush.generateVAPIDKeys();
    vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "" };
  }
  // The push services want a contact address for whoever sends notifications.
  vapid = { ...vapid, subject: publicUrl || vapid.subject || "https://nopostnow.invalid" };

  writeConfig(dataDir, {
    siteName,
    tagline,
    accent: accent.toLowerCase(),
    host,
    port,
    publicUrl,
    signup,
    timeZone,
    dailyMoment,
    termsAcceptedAt,
    vapid,
  });
  writePointer(appDir, path.relative(appDir, dataDir).startsWith("..") ? dataDir : path.relative(appDir, dataDir) || ".");

  // --- first admin -----------------------------------------------------------
  const db = openDatabase(dataDir);
  try {
    if (countAdmins(db) === 0) {
      heading(6, "Your admin account");
      console.log(dim("  This is how you sign in. The email is only a login name — the site never\n  sends mail — so use any address you'll remember."));
      const email = await ask("  Email", {
        check: (v) =>
          validateEmail(normalizeEmail(v)) ?? (getAccountByEmail(db, v) ? "That email already has an account." : null),
      });
      const username = await ask("  Username (what friends see)", { check: validateUsername });
      const password = await ask("  Password (8+ characters)", { secret: true, check: validatePassword });
      createAccount(db, { email, username, password, role: "admin" });
      console.log(green(`  Admin account created for ${username}.`));
    }
  } finally {
    db.close();
  }

  console.log(`\n${green(bold("Setup saved."))} ${dim(`Settings are in ${path.join(dataDir, "config.json")}`)}`);

  printGoingOnline({ siteName, host, port, publicUrl, ips });
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(red(`\n${err instanceof Error ? err.message : String(err)}`));
} finally {
  closePrompts();
}
process.exit(code);
