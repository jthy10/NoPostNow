// The relay end to end: a stand-in site behind a connector, reached through a
// relay by host name. Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claimName, startTunnel } from "../relay/client.mjs";
import { validateSiteName } from "../relay/protocol.mjs";
import { startRelay } from "../relay/server.mjs";

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(port, host, { method = "GET", path: p = "/", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: "127.0.0.1", method, path: p, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("site names", () => {
  assert.equal(validateSiteName("lake-house"), null);
  for (const bad of ["ab", "-abc", "abc-", "Has Caps", "a--b", "www", "x".repeat(31), "a.b"]) {
    assert.ok(validateSiteName(bad), bad);
  }
});

test("a site is reachable through the relay", async () => {
  // The stand-in site: echoes what it received, and has one streaming route.
  const site = http.createServer((req, res) => {
    if (req.url === "/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: one\n\n");
      setTimeout(() => res.end("data: two\n\n"), 150);
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "a=1; Path=/" });
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, bytes: body.length, sum: body.reduce((a, b) => (a + b) % 65521, 0) }));
    });
  });
  const sitePort = await listen(site);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nopostnow-relay-"));
  const config = { domain: "relay.test", host: "127.0.0.1", port: 0, registration: "key", keys: ["letmein-letmein"], maxSites: 10 };
  const relay = await startRelay({ dataDir, config, log: () => {} });
  const port = relay.server.address().port;
  const relayUrl = `http://127.0.0.1:${port}`;
  const secret = "s".repeat(40);
  const stops = [];

  try {
    // Claiming a name
    await assert.rejects(claimName(relayUrl, { name: "lake", secret, key: "wrong" }), /access key/);
    await assert.rejects(claimName(relayUrl, { name: "www", secret, key: "letmein-letmein" }), /reserved/);
    assert.equal(await claimName(relayUrl, { name: "lake", secret, key: "letmein-letmein" }), "https://lake.relay.test");
    assert.equal(await claimName(relayUrl, { name: "lake", secret }), "https://lake.relay.test", "the owner can re-check");
    await assert.rejects(claimName(relayUrl, { name: "lake", secret: "x".repeat(40), key: "letmein-letmein" }), /taken/);

    // Certificate check used by the HTTPS front
    assert.equal((await request(port, "relay.test", { path: "/_relay/ask?domain=lake.relay.test" })).status, 200);
    assert.equal((await request(port, "relay.test", { path: "/_relay/ask?domain=nobody.relay.test" })).status, 404);
    assert.equal((await request(port, "relay.test", { path: "/_relay/ask?domain=evil.example" })).status, 404);

    // Not connected yet
    assert.equal((await request(port, "lake.relay.test")).status, 502);
    assert.equal((await request(port, "nobody.relay.test")).status, 404);

    // A stranger can't attach to someone else's name
    let refused = "";
    const stopBad = startTunnel({ relayUrl, name: "lake", secret: "x".repeat(40), localPort: sitePort, onStatus: (s, d) => (refused = `${s}:${d}`) });
    stops.push(stopBad);
    await sleep(300);
    stopBad();
    assert.match(refused, /down:.*name and secret/);
    assert.equal((await request(port, "lake.relay.test")).status, 502);

    // The real owner attaches
    let state = "";
    const stop = startTunnel({ relayUrl, name: "lake", secret, localPort: sitePort, onStatus: (s) => (state = s) });
    stops.push(stop);
    for (let i = 0; i < 50 && state !== "up"; i++) await sleep(50);
    assert.equal(state, "up");

    const got = await request(port, "lake.relay.test", { path: "/hello?x=1", headers: { "x-forwarded-for": "6.6.6.6", "x-forwarded-proto": "https", cookie: "k=v" } });
    assert.equal(got.status, 200);
    assert.equal(got.headers["set-cookie"][0], "a=1; Path=/");
    const seen = JSON.parse(got.body);
    assert.equal(seen.url, "/hello?x=1");
    assert.equal(seen.headers.host, "lake.relay.test");
    assert.equal(seen.headers["x-forwarded-host"], "lake.relay.test");
    assert.equal(seen.headers["x-forwarded-proto"], "https");
    assert.equal(seen.headers.cookie, "k=v");

    // A large upload arrives intact
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    const up = JSON.parse((await request(port, "lake.relay.test", { method: "PUT", path: "/up", body: big, headers: { "content-length": big.length } })).body);
    assert.equal(up.bytes, big.length);
    assert.equal(up.sum, big.reduce((a, b) => (a + b) % 65521, 0));

    // Streams pass through without being held back
    const stream = await request(port, "lake.relay.test", { path: "/stream" });
    assert.equal(stream.body.toString(), "data: one\n\ndata: two\n\n");

    // Many at once, and connections are reused afterwards
    const many = await Promise.all(Array.from({ length: 40 }, (_, i) => request(port, "lake.relay.test", { path: `/n/${i}` })));
    assert.ok(many.every((r, i) => r.status === 200 && JSON.parse(r.body).url === `/n/${i}`));

    // Another name never reaches this site
    assert.equal((await request(port, "other.relay.test")).status, 404);
    assert.equal((await request(port, "a.lake.relay.test")).status, 404);

    // Going offline
    stop();
    await sleep(200);
    assert.equal((await request(port, "lake.relay.test")).status, 502);
  } finally {
    for (const stop of stops) stop();
    relay.close();
    site.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
