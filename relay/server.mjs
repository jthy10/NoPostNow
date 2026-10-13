// The relay: a small public server that gives home-hosted sites an address.
//
// Run it on a machine with a public IP, behind something that terminates
// HTTPS for *.your-domain (see docs/RELAY.md). Each site that connects gets
// https://<name>.<domain>; visitors' requests are passed down the site's own
// outbound connection, so the site needs no open ports and no domain.
//
// The relay stores no photos, posts or accounts — only the list of claimed
// names. It does carry every request in the clear between its HTTPS front and
// the site, so whoever runs a relay must be trusted by the sites that use it.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  ASK_PATH,
  CLAIM_PATH,
  CONTROL_PATH,
  DATA_PATH,
  hashSecret,
  lineReader,
  send,
  validateSiteName,
  wsAccept,
} from "./protocol.mjs";

const OPEN_TIMEOUT_MS = 10_000;
const PING_MS = 25_000;
const MAX_HEADER_NAME = /^x-forwarded-|^cf-|^x-real-ip$|^forwarded$/;

export function readRelayConfig(dataDir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "relay.json"), "utf8"));
  return {
    domain: String(raw.domain || "").toLowerCase().replace(/^\.+|\.+$/g, ""),
    host: String(raw.host || "127.0.0.1"),
    port: Number(raw.port) || 8080,
    // "open": anyone may claim a free name. "key": only with an access key.
    registration: raw.registration === "open" ? "open" : "key",
    keys: Array.isArray(raw.keys) ? raw.keys.map(String) : [],
    maxSites: Number(raw.maxSites) || 500,
  };
}

export function startRelay({ dataDir, config, log = console.log }) {
  const sitesFile = path.join(dataDir, "sites.json");
  /** name -> { secretHash, createdAt, lastSeen } */
  let sites = {};
  try {
    sites = JSON.parse(fs.readFileSync(sitesFile, "utf8"));
  } catch {}
  const saveSites = () => {
    const partial = `${sitesFile}.part`;
    fs.writeFileSync(partial, JSON.stringify(sites, null, 2), { mode: 0o600 });
    fs.renameSync(partial, sitesFile);
  };

  /** name -> { control, agent, pending: Map<id, {resolve, reject, timer}> } */
  const online = new Map();

  const secretOk = (name, secret) => {
    const site = sites[name];
    if (!site || typeof secret !== "string") return false;
    const a = Buffer.from(site.secretHash, "hex");
    const b = Buffer.from(hashSecret(secret), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const keyOk = (key) =>
    config.registration === "open" ||
    (typeof key === "string" &&
      config.keys.some((k) => k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key))));

  // Which site a Host header names: its name, null when the request is for
  // the relay itself, or "" for an address under the domain that can never be
  // a site (names are exactly one label deep).
  const siteOf = (hostHeader) => {
    const host = String(hostHeader || "").toLowerCase().replace(/:\d+$/, "");
    if (!host.endsWith(`.${config.domain}`)) return null;
    const name = host.slice(0, -config.domain.length - 1);
    return name.includes(".") ? "" : name;
  };

  // --- claim throttling ------------------------------------------------------
  const attempts = new Map();
  const throttled = (ip) => {
    const now = Date.now();
    const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    recent.push(now);
    attempts.set(ip, recent);
    if (attempts.size > 10_000) attempts.clear();
    return recent.length > 30;
  };

  const ipOf = (req) =>
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";

  // --- a visitor's request for a site ----------------------------------------
  function proxy(req, res, name) {
    const site = online.get(name);
    if (!site) {
      res.writeHead(sites[name] ? 502 : 404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(sites[name] ? "This site is offline right now. Try again in a little while.\n" : "There is no site at this address.\n");
      return;
    }
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // Never let a visitor speak for the relay: these are set below.
      if (MAX_HEADER_NAME.test(key) || key === "connection" || key === "upgrade") continue;
      headers[key] = value;
    }
    headers["x-forwarded-host"] = req.headers.host;
    headers["x-forwarded-proto"] = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    headers["x-forwarded-for"] = ipOf(req);

    const offline = () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("This site is offline right now. Try again in a little while.\n");
    };
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    // A kept-alive connection can be closed by the site at the very moment it
    // is reused. Requests without a body are safe to send once more.
    const attempt = (retries) => {
      const upstream = http.request({ agent: site.agent, method: req.method, path: req.url, headers });
      upstream.on("response", (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
        answer.on("error", () => res.destroy());
      });
      upstream.on("error", () => {
        if (retries > 0 && !res.headersSent && !res.destroyed) attempt(retries - 1);
        else offline();
      });
      res.on("close", () => upstream.destroy());
      if (hasBody) req.pipe(upstream);
      else upstream.end();
    };
    attempt(hasBody ? 0 : 1);
  }

  // --- the relay's own small API ---------------------------------------------
  function api(req, res) {
    const url = new URL(req.url, "http://relay");
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };

    // Asked by the HTTPS front before it obtains a certificate for a name.
    if (url.pathname === ASK_PATH) {
      const domain = String(url.searchParams.get("domain") || "").toLowerCase();
      const name = siteOf(domain);
      return json(domain === config.domain || (name && sites[name]) ? 200 : 404, {});
    }

    if (url.pathname === CLAIM_PATH && req.method === "POST") {
      if (throttled(ipOf(req))) return json(429, { error: "Too many attempts — try again in an hour." });
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 4096) req.destroy();
      });
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(400, { error: "Malformed request." });
        }
        const name = String(body.name || "").toLowerCase();
        const problem = validateSiteName(name);
        if (problem) return json(400, { error: problem });
        if (typeof body.secret !== "string" || body.secret.length < 32) {
          return json(400, { error: "Malformed request." });
        }
        if (sites[name]) {
          // Claiming again with the same secret is how a site re-checks itself.
          return secretOk(name, body.secret)
            ? json(200, { url: `https://${name}.${config.domain}` })
            : json(409, { error: "That name is taken — pick another." });
        }
        if (!keyOk(body.key)) return json(403, { error: "This relay needs a valid access key." });
        if (Object.keys(sites).length >= config.maxSites) return json(403, { error: "This relay is full." });
        sites[name] = { secretHash: hashSecret(body.secret), createdAt: Date.now(), lastSeen: 0 };
        saveSites();
        log(`claimed ${name}`);
        return json(200, { url: `https://${name}.${config.domain}` });
      });
      return;
    }

    if (url.pathname === "/" || url.pathname === "") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`NoPostNow relay for ${config.domain}\n${online.size} site(s) online.\n`);
      return;
    }
    json(404, { error: "Not found." });
  }

  const server = http.createServer((req, res) => {
    const name = siteOf(req.headers.host);
    if (name !== null) proxy(req, res, name);
    else api(req, res);
  });
  // Uploads and event streams can be long; let the site decide when to stop.
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;

  // --- connections from sites --------------------------------------------------
  server.on("upgrade", (req, socket) => {
    const refuse = (status, text) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const url = new URL(req.url, "http://relay");
    const name = String(req.headers["x-relay-name"] || "");
    const key = req.headers["sec-websocket-key"];
    // Site names never accept upgrades; only the relay's own address does.
    if (siteOf(req.headers.host) !== null || !key) return refuse(400, "Bad Request");
    if (!secretOk(name, req.headers["x-relay-secret"])) return refuse(401, "Unauthorized");
    const accept = () =>
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`
      );
    socket.on("error", () => {});

    if (url.pathname === DATA_PATH) {
      const waiting = online.get(name)?.pending.get(String(url.searchParams.get("id")));
      if (!waiting) return refuse(404, "Not Found");
      accept();
      waiting.resolve(socket);
      return;
    }

    if (url.pathname !== CONTROL_PATH) return refuse(404, "Not Found");
    accept();
    socket.setKeepAlive(true, 30_000);

    // A site that reconnects replaces its previous connection.
    online.get(name)?.close();

    const pending = new Map();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 8 });
    agent.createConnection = (_options, callback) => {
      const id = crypto.randomBytes(12).toString("hex");
      const timer = setTimeout(() => {
        pending.delete(id);
        callback(new Error("The site did not answer."));
      }, OPEN_TIMEOUT_MS);
      pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          pending.delete(id);
          callback(null, data);
        },
      });
      send(socket, { t: "open", id });
    };
    const ping = setInterval(() => send(socket, { t: "ping" }), PING_MS);
    const entry = {
      pending,
      agent,
      close: () => {
        clearInterval(ping);
        agent.destroy();
        socket.destroy();
        if (online.get(name) === entry) online.delete(name);
      },
    };
    online.set(name, entry);
    sites[name].lastSeen = Date.now();
    saveSites();
    log(`online  ${name}`);
    lineReader(socket, () => {});
    // The HTTP server leaves sockets half-open; when the site hangs up, so do we.
    socket.on("end", () => socket.destroy());
    socket.on("close", () => {
      if (online.get(name) === entry) log(`offline ${name}`);
      entry.close();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () =>
      resolve({
        server,
        close: () => {
          for (const entry of online.values()) entry.close();
          server.close();
        },
      })
    );
  });
}
