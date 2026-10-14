#!/usr/bin/env node
// The control panel: a small window for running a site without a terminal.
// Server details on the left, the live console on the right, and an Options
// window for the name, address, port and everything else setup asks about.
//
// It is an ordinary local web page served by Node's built-in HTTP server —
// no extra software — bound to this computer only and locked to the browser
// window it opens.
//
//   sh nopostnow.sh                 open the panel (starts the site too)
//   node scripts/panel.mjs --no-open   print the panel's address instead
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  DEFAULT_CONFIG,
  hasConfig,
  isValidTimeZone,
  normalizeConfig,
  readConfig,
  resolveDataDir,
  writeConfig,
  writePointer,
} from "../server/core/config.ts";
import { openDatabase } from "../server/core/db.ts";
import {
  countAdmins,
  createAccount,
  createInvite,
  createResetToken,
  getAccountByEmail,
  listAccounts,
} from "../server/core/accounts.ts";
import { appDir, buildIsCurrent, stampBuild } from "./lib.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const PAGE = fs.readFileSync(path.join(appDir, "scripts", "panel.html"), "utf8");
const version = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;

// --- state -----------------------------------------------------------------

let dataDir = resolveDataDir(appDir);
let status = "stopped"; // stopped | building | starting | running
let child = null;
let wanted = false; // whether the site is meant to be running

const LOG_LIMIT = 800;
const logs = [];
const listeners = new Set();
let logId = 0;

function log(text, kind = "out") {
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Strip terminal colour codes; the panel does its own styling.
    const entry = { id: ++logId, at: Date.now(), kind, text: line.replace(/\x1b\[[0-9;]*m/g, "") };
    logs.push(entry);
    if (logs.length > LOG_LIMIT) logs.shift();
    for (const send of listeners) send("log", entry);
  }
}

function announce() {
  const snapshot = state();
  for (const send of listeners) send("state", snapshot);
}

function setStatus(next) {
  status = next;
  announce();
}

const configured = () => hasConfig(dataDir);
const currentConfig = () => (configured() ? readConfig(dataDir) : DEFAULT_CONFIG);

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

function memberCounts() {
  if (!configured()) return { members: 0, admins: 0 };
  const db = openDatabase(dataDir);
  try {
    const accounts = listAccounts(db);
    return { members: accounts.length, admins: accounts.filter((a) => a.role === "admin").length };
  } finally {
    db.close();
  }
}

function state() {
  const config = currentConfig();
  const { vapid, ...shown } = config;
  return {
    configured: configured(),
    status,
    version,
    node: process.versions.node,
    dataDir,
    config: shown,
    pushReady: Boolean(vapid.publicKey && vapid.privateKey),
    localUrl: `http://localhost:${config.port}`,
    lanUrls: config.host === "0.0.0.0" ? lanAddresses().map((ip) => `http://${ip}:${config.port}`) : [],
    lanIps: lanAddresses(),
    systemZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ...memberCounts(),
  };
}

// --- running the site ----------------------------------------------------------

function run(args, label) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [nextBin, ...args], {
      cwd: appDir,
      env: { ...process.env, NOPOSTNOW_DATA_DIR: dataDir, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.on("data", (chunk) => log(chunk, "out"));
    proc.stderr.on("data", (chunk) => log(chunk, "err"));
    proc.on("error", (err) => log(`${label}: ${err.message}`, "err"));
    proc.on("exit", (code) => resolve(code ?? 0));
    child = proc;
  });
}

function portFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

async function startSite() {
  if (status !== "stopped" || !configured()) return;
  wanted = true;
  const config = readConfig(dataDir);

  if (!buildIsCurrent()) {
    setStatus("building");
    log("Building the site (about a minute, once per version)…", "info");
    const code = await run(["build"], "build");
    child = null;
    if (code !== 0 || !wanted) {
      if (code !== 0) log("The build failed — see the messages above.", "err");
      wanted = false;
      return setStatus("stopped");
    }
    stampBuild();
  }

  if (!(await portFree(config.port, config.host))) {
    log(`Port ${config.port} is already in use. Pick another port in Options, or close whatever is using it.`, "err");
    wanted = false;
    return setStatus("stopped");
  }

  setStatus("starting");
  log(`Starting ${config.siteName} on port ${config.port}…`, "info");
  const exited = run(["start", "-p", String(config.port), "-H", config.host], "site");
  const proc = child;
  proc.stdout.on("data", (chunk) => {
    if (status === "starting" && /Ready/.test(String(chunk))) {
      setStatus("running");
      log(`${config.siteName} is running at http://localhost:${config.port}`, "info");
    }
  });
  const code = await exited;
  if (child === proc) child = null;
  if (wanted) log(`The site stopped unexpectedly (exit code ${code}).`, "err");
  wanted = false;
  setStatus("stopped");
}

function stopSite() {
  wanted = false;
  if (!child) return Promise.resolve();
  const proc = child;
  log("Stopping…", "info");
  return new Promise((resolve) => {
    proc.once("exit", resolve);
    proc.kill();
    // A process that ignores the polite request gets a firm one.
    setTimeout(() => proc.exitCode === null && proc.kill("SIGKILL"), 5000).unref();
  });
}

// --- saving options -----------------------------------------------------------------

const fail = (message) => Object.assign(new Error(message), { expected: true });

async function saveOptions(input) {
  const first = !configured();
  const before = currentConfig();
  const text = (key, fallback = "") => (typeof input[key] === "string" ? input[key].trim() : fallback);

  if (first && input.acceptTerms !== true) throw fail("Accept the terms to continue.");

  const siteName = text("siteName") || before.siteName;
  if (siteName.length > 40) throw fail("Keep the site name to 40 characters or fewer.");
  const accent = text("accent", before.accent);
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw fail("The accent colour must look like #ff3b5c.");

  const host = text("host", before.host);
  if (!net.isIP(host)) throw fail("The address to listen on must be an IP address, such as 0.0.0.0 or 192.168.1.20.");
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail("The port must be a number between 1 and 65535.");
  if (port < 1024 && process.platform !== "win32" && process.getuid?.() !== 0) {
    throw fail("Ports below 1024 need administrator rights — pick one above 1024.");
  }

  const timeZone = text("timeZone", before.timeZone);
  if (!isValidTimeZone(timeZone)) throw fail("That time zone isn't recognised — use a name like America/Chicago.");
  const moment = input.dailyMoment ?? {};
  if (moment.enabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(moment.time))) {
    throw fail("The daily moment needs a time, such as 19:30.");
  }
  if (moment.specialDate && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(moment.specialDate))) {
    throw fail("The special date must be written MM-DD, such as 07-04.");
  }

  // Where everything is stored.
  const nextDataDir = path.resolve(appDir, text("dataDir") || dataDir);
  try {
    fs.mkdirSync(nextDataDir, { recursive: true });
    fs.accessSync(nextDataDir, fs.constants.W_OK);
  } catch {
    throw fail("Can't write to that data folder — choose another.");
  }
  if (!first && nextDataDir !== dataDir && !hasConfig(nextDataDir) && input.confirmMove !== true) {
    throw Object.assign(fail(`Your photos and accounts are in ${dataDir}. Switching folders starts an empty site there — move the folder's contents yourself to keep them.`), { needsConfirm: "confirmMove" });
  }

  // The address friends use, if the host already has one.
  const publicUrl = text("publicUrl").replace(/\/+$/, "");
  if (publicUrl && !/^https?:\/\/[^\s/]+/.test(publicUrl)) {
    throw fail("The public address must start with https:// — for example https://photos.example.com");
  }

  // The first admin, validated before anything is written.
  const admin = input.admin ?? {};
  const targetDb = openDatabase(nextDataDir);
  try {
    const needsAdmin = countAdmins(targetDb) === 0;
    if (needsAdmin && !(admin.email && admin.username && admin.password)) {
      throw Object.assign(fail("Fill in the admin account — it is how you will sign in."), { needsAdmin: true });
    }
    if (needsAdmin) {
      try {
        createAccount(targetDb, { email: admin.email, username: admin.username, password: admin.password, role: "admin" });
      } catch (err) {
        throw fail(err.message);
      }
    }
  } finally {
    targetDb.close();
  }

  let vapid = hasConfig(nextDataDir) ? readConfig(nextDataDir).vapid : before.vapid;
  if (!vapid.publicKey || !vapid.privateKey) {
    const keys = require("web-push").generateVAPIDKeys();
    vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "" };
  }
  vapid = { ...vapid, subject: publicUrl || "https://nopostnow.invalid" };

  const next = normalizeConfig({
    siteName,
    tagline: text("tagline") || before.tagline,
    accent,
    host,
    port,
    publicUrl,
    signup: text("signup", before.signup),
    timeZone,
    dailyMoment: {
      enabled: moment.enabled === true,
      time: moment.time || before.dailyMoment.time,
      bothHalves: moment.bothHalves === true,
      specialDate: moment.specialDate || "",
    },
    termsAcceptedAt: before.termsAcceptedAt || new Date().toISOString(),
    vapid,
  });

  const restart =
    first || nextDataDir !== dataDir || next.host !== before.host || next.port !== before.port;

  writeConfig(nextDataDir, next);
  const relative = path.relative(appDir, nextDataDir);
  writePointer(appDir, relative.startsWith("..") || path.isAbsolute(relative) ? nextDataDir : relative || ".");
  dataDir = nextDataDir;
  log(first ? "Setup saved." : "Options saved.", "info");

  if (restart) {
    if (status !== "stopped") {
      log("Restarting to apply the new settings…", "info");
      await stopSite();
    }
    void startSite();
  }
  announce();
}

function withDb(fn) {
  const db = openDatabase(dataDir);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const origin = () => currentConfig().publicUrl || `http://localhost:${currentConfig().port}`;

// --- the panel's own web server ---------------------------------------------

const token = crypto.randomBytes(24).toString("base64url");
const COOKIE = "nopostnow_panel";
let panelPort = 0;

function authorized(req) {
  // Only this computer, only by the names it was opened under (which blocks
  // other websites from reaching the panel by pointing a domain at 127.0.0.1),
  // and only from the browser window that was handed the key.
  const host = String(req.headers.host || "");
  if (host !== `127.0.0.1:${panelPort}` && host !== `localhost:${panelPort}`) return false;
  const cookie = String(req.headers.cookie || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`));
  const given = Buffer.from(cookie ? cookie.slice(COOKIE.length + 1) : "");
  const wantedKey = Buffer.from(token);
  return given.length === wantedKey.length && crypto.timingSafeEqual(given, wantedKey);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 65536) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(fail("Malformed request."));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://panel");
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  // The link printed at launch carries the key once; it becomes a cookie.
  if (url.pathname === "/" && url.searchParams.get("k") === token) {
    res.writeHead(302, {
      "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      location: "/",
    });
    return res.end();
  }
  if (!authorized(req)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Open the control panel from the link NoPostNow printed when it started.\n");
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    return res.end(PAGE);
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("state", state());
    for (const entry of logs) send("log", entry);
    listeners.add(send);
    const beat = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(beat);
      listeners.delete(send);
    });
    return;
  }

  if (req.method !== "POST" || req.headers["x-panel"] !== "1") return json(404, { error: "Not found." });

  try {
    const body = await readJson(req);
    switch (url.pathname) {
      case "/api/start":
        void startSite();
        return json(200, {});
      case "/api/stop":
        await stopSite();
        return json(200, {});
      case "/api/restart":
        await stopSite();
        void startSite();
        return json(200, {});
      case "/api/options":
        await saveOptions(body);
        return json(200, {});
      case "/api/invite": {
        const invite = withDb((db) => createInvite(db, { createdBy: "panel", maxUses: Number(body.uses) || 1, days: 7 }));
        log(`Made an invite link (${invite.maxUses} use${invite.maxUses === 1 ? "" : "s"}, 7 days).`, "info");
        return json(200, { url: `${origin()}/login?invite=${invite.code}` });
      }
      case "/api/reset": {
        const url = withDb((db) => {
          const account = getAccountByEmail(db, String(body.email || ""));
          if (!account) throw fail("No account uses that email.");
          return `${origin()}/login?reset=${createResetToken(db, account.uid)}`;
        });
        log("Made a password reset link.", "info");
        return json(200, { url });
      }
      case "/api/quit":
        json(200, {});
        await stopSite();
        return process.exit(0);
      default:
        return json(404, { error: "Not found." });
    }
  } catch (err) {
    if (!err.expected) log(err.stack || String(err), "err");
    return json(400, { error: err.expected ? err.message : "Something went wrong — see the console.", needsConfirm: err.needsConfirm, needsAdmin: err.needsAdmin });
  }
});

// --- opening the window ------------------------------------------------------------

function findBrowser() {
  const candidates =
    process.platform === "win32"
      ? [
          `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : (process.env.PATH || "")
            .split(":")
            .flatMap((dir) => ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"].map((n) => path.join(dir, n)));
  return candidates.find((file) => file && fs.existsSync(file));
}

function openWindow(address) {
  const detached = { detached: true, stdio: "ignore" };
  try {
    // A Chromium-family browser can show the page as a plain window with no
    // tabs or address bar, which is what makes it feel like a program.
    const browser = findBrowser();
    if (browser) return spawn(browser, [`--app=${address}`, "--window-size=1180,760"], detached).on("error", () => {}).unref();
    if (process.platform === "win32") return spawn("cmd", ["/c", "start", "", address], detached).on("error", () => {}).unref();
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [address], detached).on("error", () => {}).unref();
  } catch {
    // The address is printed below either way.
  }
}

async function listen() {
  for (const port of [4780, 4781, 4782, 4783, 0]) {
    const ok = await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (ok) return server.address().port;
  }
  throw new Error("Couldn't open a port for the control panel.");
}

panelPort = await listen();
const address = `http://127.0.0.1:${panelPort}/?k=${token}`;
console.log(`\n  NoPostNow control panel\n  ${address}\n\n  Keep this window open while your site is running. Press Ctrl+C to stop.\n`);
if (!process.argv.includes("--no-open")) openWindow(address);

log(`NoPostNow ${version} · Node ${process.versions.node}`, "info");
if (configured()) void startSite();
else log("Welcome! Fill in the setup form to create your site.", "info");

// However the panel ends, the site it started must not be left holding the port.
process.on("exit", () => child?.kill());

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stopSite();
    process.exit(0);
  });
}
