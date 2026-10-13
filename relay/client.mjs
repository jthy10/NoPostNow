// The connector: runs beside a site and keeps it attached to a relay.
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { CLAIM_PATH, CONTROL_PATH, DATA_PATH, lineReader, send, wsAccept } from "./protocol.mjs";

function requester(relayUrl) {
  const url = new URL(relayUrl);
  return { url, lib: url.protocol === "https:" ? https : http };
}

// Opens one upgraded connection to the relay and hands back the raw socket.
function dial(relayUrl, path, { name, secret }) {
  const { url, lib } = requester(relayUrl);
  const key = crypto.randomBytes(16).toString("base64");
  return new Promise((resolve, reject) => {
    const req = lib.request({
      host: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
        "x-relay-name": name,
        "x-relay-secret": secret,
      },
    });
    req.setTimeout(15_000, () => req.destroy(new Error("The relay did not answer.")));
    req.on("upgrade", (res, socket, head) => {
      if (res.headers["sec-websocket-accept"] !== wsAccept(key)) {
        socket.destroy();
        return reject(new Error("The relay answered unexpectedly."));
      }
      socket.setTimeout(0);
      if (head?.length) socket.unshift(head);
      resolve(socket);
    });
    req.on("response", (res) => {
      res.resume();
      const error = new Error(
        res.statusCode === 401
          ? "The relay did not accept this site's name and secret."
          : `The relay refused the connection (${res.statusCode}).`
      );
      error.status = res.statusCode;
      reject(error);
    });
    req.on("error", reject);
    req.end();
  });
}

// Reserves a name on a relay (or confirms one this site already holds).
export function claimName(relayUrl, { name, secret, key }) {
  const { url, lib } = requester(relayUrl);
  const body = JSON.stringify({ name, secret, key });
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: CLAIM_PATH,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let answer = {};
          try {
            answer = JSON.parse(raw);
          } catch {}
          if (res.statusCode === 200 && answer.url) resolve(answer.url);
          else reject(new Error(answer.error || `The relay answered ${res.statusCode}. Is that the right address?`));
        });
      }
    );
    req.setTimeout(15_000, () => req.destroy(new Error("The relay did not answer.")));
    req.on("error", (err) => reject(new Error(`Couldn't reach the relay: ${err.message}`)));
    req.end(body);
  });
}

// Keeps the site attached for as long as the process runs, reconnecting with
// a growing pause whenever the connection drops.
export function startTunnel({ relayUrl, name, secret, localPort, localHost = "127.0.0.1", onStatus = () => {} }) {
  let stopped = false;
  let control = null;
  let delay = 1000;
  let timer = null;

  async function openData(id) {
    let remote;
    try {
      remote = await dial(relayUrl, `${DATA_PATH}?id=${id}`, { name, secret });
    } catch {
      return;
    }
    const local = net.connect(localPort, localHost);
    const end = () => {
      remote.destroy();
      local.destroy();
    };
    remote.on("error", end).on("close", end);
    local.on("error", end).on("close", end);
    remote.pipe(local);
    local.pipe(remote);
  }

  async function connect() {
    if (stopped) return;
    try {
      control = await dial(relayUrl, CONTROL_PATH, { name, secret });
    } catch (err) {
      onStatus("down", err.message);
      // A refused name will not fix itself quickly; don't hammer the relay.
      delay = err.status === 401 ? 60_000 : Math.min(delay * 2, 30_000);
      timer = setTimeout(connect, delay);
      return;
    }
    delay = 1000;
    onStatus("up");
    control.setKeepAlive(true, 30_000);
    // The relay pings every 25 seconds; silence for much longer means the
    // connection died without saying so.
    control.setTimeout(70_000, () => control.destroy());
    lineReader(control, (message) => {
      if (message.t === "open" && /^[a-f0-9]{24}$/.test(message.id)) void openData(message.id);
      else if (message.t === "ping") send(control, { t: "pong" });
    });
    control.on("error", () => {});
    control.on("close", () => {
      if (stopped) return;
      onStatus("down", "connection lost");
      timer = setTimeout(connect, delay);
    });
  }

  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    control?.destroy();
  };
}
