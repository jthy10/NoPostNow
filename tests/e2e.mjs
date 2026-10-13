// End-to-end checks: starts the built site against a throwaway data folder and
// drives it over HTTP — sign-up, posting, likes, comments, messages, admin
// actions — including every forgery and cross-member read that must be refused.
//
//   npm run build && npm run test:e2e
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createAccount, createInvite } from "../server/core/accounts.ts";
import { normalizeConfig, writeConfig } from "../server/core/config.ts";
import { openDatabase } from "../server/core/db.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nopostnow-e2e-"));
const PORT = Number(process.env.E2E_PORT ?? 3987);
const BASE = `http://127.0.0.1:${PORT}`;

writeConfig(dataDir, normalizeConfig({ siteName: "Lake House", accent: "#22aa88", host: "127.0.0.1", port: PORT }));
const seed = openDatabase(dataDir);
createAccount(seed, { email: "admin@example.com", password: "correct-horse-9", username: "HostAdmin", role: "admin" });
const INVITE = createInvite(seed, { createdBy: "e2e", maxUses: 3 }).code;
seed.close();

const server = spawn(
  process.execPath,
  [createRequire(import.meta.url).resolve("next/dist/bin/next"), "start", "-p", String(PORT), "-H", "127.0.0.1"],
  { cwd: appDir, stdio: "ignore", env: { ...process.env, NOPOSTNOW_DATA_DIR: dataDir } }
);
function finish(code) {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE + "/login")).ok) break;
  } catch {}
  if (i > 100) {
    console.error("The site did not start. Run npm run build first.");
    finish(1);
  }
  await new Promise((r) => setTimeout(r, 200));
}

let pass = 0, failCount = 0;
function ok(name, cond, extra = "") { if (cond) pass++; else { failCount++; console.log("FAIL", name, extra); } }
function client() {
  let cookie = "";
  const call = async (path, { method = "POST", body, raw, headers = {}, marker = true } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(marker ? { "x-nopostnow": "1" } : {}), ...(cookie ? { cookie } : {}), ...(raw ? {} : { "content-type": "application/json" }), ...headers },
      body: raw ?? (method === "GET" ? undefined : JSON.stringify(body ?? {})),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (c.startsWith("npn_session=")) cookie = c.split(";")[0];
    let json = null; const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) json = await res.json(); else await res.arrayBuffer();
    return { status: res.status, json, headers: res.headers };
  };
  const store = (b) => call("/api/store", { body: b });
  return { call, store, get cookie() { return cookie; } };
}
const ST = { __op: "serverTimestamp" };
const jpeg = new Uint8Array([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,0xff,0xd9]);

const admin = client(), a = client(), b = client(), anon = client();

// --- pages render
for (const p of ["/login", "/terms", "/privacy", "/manifest.webmanifest", "/robots.txt", "/app"]) {
  const r = await anon.call(p, { method: "GET" }); ok("page " + p, r.status === 200, r.status);
}
const html = await (await fetch(BASE + "/login")).text();
ok("branding in html", html.includes("Lake House"));
ok("accent applied", html.includes("#22aa88"));

// --- signed out is refused
ok("store needs auth", (await anon.store({ op: "query", spec: { parent: "photos" } })).status === 401);
ok("files need auth", (await anon.call("/api/files/photos/x/y.jpg", { method: "GET" })).status === 401);
ok("admin api needs auth", (await anon.call("/api/admin/accounts", { method: "GET" })).status === 401);
ok("events need auth", (await fetch(BASE + "/api/store/events")).status === 401);

// --- login
ok("bad password", (await admin.call("/api/auth/login", { body: { email: "admin@example.com", password: "nope" } })).status === 401);
let r = await admin.call("/api/auth/login", { body: { email: "ADMIN@example.com", password: "correct-horse-9" } });
ok("admin login", r.status === 200 && r.json.user.isAdmin, JSON.stringify(r.json));
const adminUid = r.json.user.uid;
ok("csrf marker required", (await admin.call("/api/store", { body: { op: "query", spec: { parent: "photos" } }, marker: false })).status === 403);
ok("cross origin refused", (await admin.call("/api/store", { body: { op: "query", spec: { parent: "photos" } }, headers: { origin: "https://evil.example" } })).status === 403);

// --- signup
ok("signup without invite", (await a.call("/api/auth/signup", { body: { email: "a@example.com", password: "password-aaa", username: "Alice" } })).status === 403);
r = await a.call("/api/auth/signup", { body: { email: "a@example.com", password: "password-aaa", username: "Alice", invite: INVITE } });
ok("signup A", r.status === 200 && !r.json.user.isAdmin, JSON.stringify(r.json));
const aUid = r.json.user.uid;
ok("dup username", (await b.call("/api/auth/signup", { body: { email: "b@example.com", password: "password-bbb", username: "alice", invite: INVITE } })).status === 400);
ok("weak password", (await b.call("/api/auth/signup", { body: { email: "b@example.com", password: "short", username: "Bob", invite: INVITE } })).status === 400);
r = await b.call("/api/auth/signup", { body: { email: "b@example.com", password: "password-bbb", username: "Bob", invite: INVITE } });
ok("signup B", r.status === 200); const bUid = r.json.user.uid;
r = await a.call("/api/auth/session", { method: "GET" });
ok("session", r.json.user?.uid === aUid && r.json.username === "Alice");

// --- profiles carry no email
r = await a.store({ op: "query", spec: { parent: "users" } });
ok("users listed", r.json.docs.length === 3);
ok("no emails in profiles", !JSON.stringify(r.json).includes("@example.com"));
ok("member can't list accounts", (await a.call("/api/admin/accounts", { method: "GET" })).status === 403);

// --- upload + post
const img = `photos/${aUid}/1700000000000-abc.jpg`;
ok("upload to other's folder", (await a.call(`/api/files/photos/${bUid}/x.jpg`, { method: "PUT", raw: jpeg, headers: { "content-type": "image/jpeg" } })).status === 403);
ok("upload non-image", (await a.call(`/api/files/photos/${aUid}/evil.jpg`, { method: "PUT", raw: new TextEncoder().encode("<html><script>alert(1)</script>"), headers: { "content-type": "image/jpeg" } })).status === 415);
ok("traversal", [403, 404].includes((await a.call(`/api/files/photos/${aUid}/..%2F..%2Fconfig.json`, { method: "GET" })).status));
ok("upload", (await a.call(`/api/files/${img}`, { method: "PUT", raw: jpeg, headers: { "content-type": "image/jpeg" } })).status === 200);
ok("no overwrite", (await a.call(`/api/files/${img}`, { method: "PUT", raw: jpeg, headers: { "content-type": "image/jpeg" } })).status === 409);
r = await b.call(`/api/files/${img}`, { method: "GET" });
ok("member reads photo", r.status === 200 && r.headers.get("content-type") === "image/jpeg");
const post = { userUUID: aUid, username: "Alice", imagePath: img, caption: "hello", timestamp: ST, likedBy: [] };
ok("post as someone else", (await b.store({ op: "add", parent: "photos", data: { ...post } })).status === 403);
ok("post with forged name", (await a.store({ op: "add", parent: "photos", data: { ...post, username: "Bob" } })).status === 403);
ok("post with client time", (await a.store({ op: "add", parent: "photos", data: { ...post, timestamp: { __ts: 1 } } })).status === 403);
ok("post with missing image", (await a.store({ op: "add", parent: "photos", data: { ...post, imagePath: `photos/${aUid}/nope.jpg` } })).status === 400);
ok("post with prefilled likes", (await a.store({ op: "add", parent: "photos", data: { ...post, likedBy: [bUid] } })).status === 403);
r = await a.store({ op: "add", parent: "photos", data: post });
ok("post", r.status === 200, JSON.stringify(r.json)); const postPath = r.json.path; const postId = postPath.split("/")[1];
r = await b.store({ op: "query", spec: { parent: "photos", orderBy: [["timestamp", "desc"]], limit: 6 } });
ok("feed", r.json.docs.length === 1 && typeof r.json.docs[0].data.timestamp.__ts === "number");

// --- likes
ok("like", (await b.store({ op: "update", path: postPath, data: { likedBy: { __op: "arrayUnion", values: [bUid] } } })).status === 200);
ok("like as other", (await b.store({ op: "update", path: postPath, data: { likedBy: { __op: "arrayUnion", values: [adminUid] } } })).status === 403);
ok("non-owner caption edit", (await b.store({ op: "update", path: postPath, data: { caption: "hax" } })).status === 403);
ok("owner caption edit", (await a.store({ op: "update", path: postPath, data: { caption: "edited" } })).status === 200);
ok("owner can't reassign", (await a.store({ op: "update", path: postPath, data: { userUUID: bUid } })).status === 403);
r = await a.store({ op: "query", spec: { parent: "photos", where: [["likedBy", "array-contains", bUid]] } });
ok("array-contains", r.json.docs.length === 1 && r.json.docs[0].data.caption === "edited");

// --- comments
const cPar = `${postPath}/comments`;
r = await b.store({ op: "add", parent: cPar, data: { userUUID: bUid, username: "Bob", text: "nice", timestamp: ST, likedBy: [] } });
ok("comment", r.status === 200); const cPath = r.json.path;
ok("comment forged", (await b.store({ op: "add", parent: cPar, data: { userUUID: aUid, username: "Alice", text: "x", timestamp: ST, likedBy: [] } })).status === 403);
ok("comment count", (await a.store({ op: "count", spec: { parent: cPar } })).json.count === 1);
ok("group query", (await a.store({ op: "query", spec: { group: "comments", where: [["userUUID", "==", bUid]] } })).json.docs.length === 1);
ok("other can't delete comment", (await a.store({ op: "delete", path: cPath })).status === 403);

// --- DMs
const tid = [aUid, bUid].sort().join("_");
const uids = [aUid, bUid].sort();
ok("dm thread", (await a.store({ op: "merge", path: `dms/${tid}`, data: { uids, names: { [aUid]: "Alice", [bUid]: "Bob" }, lastText: "hi", lastFrom: aUid, lastAt: ST, seenAt: { [aUid]: ST } } })).status === 200);
ok("dm message", (await a.store({ op: "add", parent: `dms/${tid}/messages`, data: { from: aUid, text: "hi", at: ST } })).status === 200);
ok("dm forged sender", (await a.store({ op: "add", parent: `dms/${tid}/messages`, data: { from: bUid, text: "hi", at: ST } })).status === 403);
ok("dm seen dotted", (await b.store({ op: "update", path: `dms/${tid}`, data: { [`seenAt.${bUid}`]: ST } })).status === 200);
r = await b.store({ op: "get", path: `dms/${tid}` });
ok("dm merge kept both seen", r.json.doc && r.json.doc.data.seenAt[aUid] && r.json.doc.data.seenAt[bUid]);
ok("dm clear other's copy", (await b.store({ op: "update", path: `dms/${tid}`, data: { [`clearedAt.${aUid}`]: ST } })).status === 403);
ok("outsider can't read thread", (await admin.store({ op: "get", path: `dms/${tid}` })).status === 403);
ok("outsider can't read messages", (await admin.store({ op: "query", spec: { parent: `dms/${tid}/messages` } })).json.docs.length === 0);
ok("outsider thread list empty", (await admin.store({ op: "query", spec: { parent: "dms", where: [["uids", "array-contains", aUid]] } })).json.docs.length === 0);
ok("outsider group query empty", (await admin.store({ op: "query", spec: { group: "messages" } })).json.docs.length === 0);

// --- notifications, blocks, prefs
ok("bell item", (await b.store({ op: "add", parent: `notifications/${aUid}/items`, data: { type: "like", actorUid: bUid, actorName: "Bob", postId, at: ST } })).status === 200);
ok("bell forged actor", (await b.store({ op: "add", parent: `notifications/${aUid}/items`, data: { type: "like", actorUid: adminUid, actorName: "HostAdmin", postId, at: ST } })).status === 403);
ok("bell not readable by others", (await admin.store({ op: "query", spec: { parent: `notifications/${aUid}/items` } })).json.docs.length === 0);
ok("bell readable by owner", (await a.store({ op: "query", spec: { parent: `notifications/${aUid}/items`, orderBy: [["at", "desc"]], limit: 10 } })).json.docs.length === 1);
ok("block", (await a.store({ op: "merge", path: `blocks/${aUid}`, data: { blocked: { __op: "arrayUnion", values: [bUid] } } })).status === 200);
ok("block other's list", (await b.store({ op: "merge", path: `blocks/${aUid}`, data: { blocked: [] } })).status === 403);
ok("prefs", (await a.store({ op: "set", path: `notifPrefs/${aUid}`, data: { uid: aUid, posts: true, comments: true, likes: false, dms: true, daily: true, quietStart: null, quietEnd: null, tz: "America/Chicago", updatedAt: ST } })).status === 200);
ok("prefs private", (await b.store({ op: "get", path: `notifPrefs/${aUid}` })).status === 403);

// --- profile edits
ok("rename", (await a.store({ op: "update", path: `users/${aUid}`, data: { username: "Alicia" } })).status === 200);
ok("rename to taken", (await a.store({ op: "update", path: `users/${aUid}`, data: { username: "bob" } })).status === 403);
ok("self unmute/mute denied", (await a.store({ op: "update", path: `users/${aUid}`, data: { muted: false } })).status === 403);
ok("edit other's profile", (await a.store({ op: "update", path: `users/${bUid}`, data: { username: "Hacked" } })).status === 403);
ok("restamp post name", (await a.store({ op: "update", path: postPath, data: { username: "Alicia" } })).status === 200);
ok("unknown collection", (await a.store({ op: "set", path: "secrets/x", data: { a: 1 } })).status === 403);
ok("config write denied", (await a.store({ op: "set", path: "config/announcement", data: { text: "x" } })).status === 403);

// --- admin: stale vs fresh
r = await admin.call("/api/admin/accounts", { method: "GET" });
ok("admin lists accounts", r.status === 200 && r.json.accounts.length === 3 && r.json.accounts[1].email === "a@example.com");
ok("admin mute", (await admin.store({ op: "merge", path: `users/${bUid}`, data: { muted: true } })).status === 200);
ok("muted can't comment", (await b.store({ op: "add", parent: cPar, data: { userUUID: bUid, username: "Bob", text: "again", timestamp: ST, likedBy: [] } })).status === 403);
ok("muted can still like", (await b.store({ op: "update", path: postPath, data: { likedBy: { __op: "arrayRemove", values: [bUid] } } })).status === 200);
r = await admin.call("/api/admin/invite-create", { body: { maxUses: 1, days: 1 } });
ok("admin invite", r.status === 200 && r.json.url.includes("/login?invite="));
r = await admin.call("/api/admin/reset-link", { body: { uid: bUid } });
ok("reset link", r.status === 200); const token = new URL(r.json.url).searchParams.get("reset");
ok("reset", (await anon.call("/api/auth/reset", { body: { token, password: "brand-new-pass" } })).status === 200);
ok("reset single use", (await anon.call("/api/auth/reset", { body: { token, password: "another-pass-1" } })).status === 400);
ok("old session ended by reset", (await b.call("/api/auth/session", { method: "GET" })).json.user === null);
ok("new password works", (await b.call("/api/auth/login", { body: { email: "b@example.com", password: "brand-new-pass" } })).status === 200);
ok("member can't use admin api", (await a.call("/api/admin/site", { body: { site: { siteName: "x" } } })).status === 403);
r = await admin.call("/api/admin/site", { body: { site: { siteName: "Cabin Crew", host: "evil", port: 1 } } });
ok("site rename", r.status === 200 && r.json.site.siteName === "Cabin Crew");
ok("rename live", (await (await fetch(BASE + "/login")).text()).includes("Cabin Crew"));
ok("can't demote last admin", (await admin.call("/api/admin/set-role", { body: { uid: adminUid, role: "member" } })).status === 400);
ok("broadcast w/o push keys", [503].includes((await admin.call("/api/broadcast", { body: { message: "hi" } })).status));
ok("notify ok w/o push", (await a.call("/api/notify-post", { body: { type: "post", postId } })).status === 200);

// --- account changes
ok("password change wrong current", (await a.call("/api/auth/password", { body: { password: "bad", newPassword: "whatever-123" } })).status === 401);
ok("email change", (await a.call("/api/auth/email", { body: { password: "password-aaa", newEmail: "alice2@example.com" } })).status === 200);
ok("email taken", (await a.call("/api/auth/email", { body: { password: "password-aaa", newEmail: "b@example.com" } })).status === 400);

// --- deletion cascades
ok("delete post by other", (await b.store({ op: "delete", path: postPath })).status === 403);
ok("delete account", (await a.call("/api/auth/delete-account", { body: { password: "password-aaa" } })).status === 200);
ok("post gone", (await b.store({ op: "get", path: postPath })).json.doc === null);
ok("comments gone", (await b.store({ op: "query", spec: { group: "comments" } })).json.docs.length === 0);
ok("file gone", (await b.call(`/api/files/${img}`, { method: "GET" })).status === 404);
ok("deleted can't login", (await a.call("/api/auth/login", { body: { email: "alice2@example.com", password: "password-aaa" } })).status === 401);

// --- behind https the session cookie is host-locked
{
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "x-nopostnow": "1", "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify({ email: "admin@example.com", password: "correct-horse-9" }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).join(";");
  ok("https cookie is __Host- and Secure", cookie.startsWith("__Host-npn_session=") && /; Secure/i.test(cookie), cookie.slice(0, 40));
  const value = cookie.split(";")[0].split("=")[1];
  const plain = await fetch(BASE + "/api/auth/session", { headers: { "x-forwarded-proto": "https", cookie: `npn_session=${value}` } });
  ok("plain cookie ignored over https", (await plain.json()).user === null);
}

// --- logout
await b.call("/api/auth/logout");
ok("logged out", (await b.store({ op: "query", spec: { parent: "photos" } })).status === 401);
const sec = await fetch(BASE + "/login");
ok("csp header", (sec.headers.get("content-security-policy") || "").includes("default-src 'self'"));
console.log(`${pass} passed, ${failCount} failed`);
finish(failCount ? 1 : 0);
