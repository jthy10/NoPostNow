// Shared by the relay and the connector that runs beside a site.
//
// A site keeps one outbound "control" connection open to the relay. When a
// visitor's request arrives for that site, the relay asks over the control
// connection for a "data" connection; the site dials back, and the relay
// sends the request down it. Both kinds start as a standard WebSocket
// handshake so they pass through ordinary HTTPS proxies, then carry raw bytes.
import crypto from "node:crypto";

export const CONTROL_PATH = "/_relay/control";
export const DATA_PATH = "/_relay/data";
export const CLAIM_PATH = "/_relay/claim";
export const ASK_PATH = "/_relay/ask";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function wsAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

export function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

// Names become subdomains, so: lowercase letters, digits and inner hyphens.
const RESERVED = new Set([
  "www", "api", "app", "admin", "mail", "smtp", "ftp", "ns", "ns1", "ns2", "relay", "status",
  "support", "help", "login", "auth", "account", "accounts", "secure", "billing", "static",
  "cdn", "assets", "blog", "docs", "nopostnow",
]);

export function validateSiteName(name) {
  if (typeof name !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(name)) {
    return "Use 3 to 30 lowercase letters, digits or hyphens, starting and ending with a letter or digit.";
  }
  if (name.includes("--")) return "Names can't contain two hyphens in a row.";
  if (RESERVED.has(name)) return "That name is reserved — pick another.";
  return null;
}

// Splits a stream into newline-terminated JSON messages.
export function lineReader(socket, onMessage) {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.length > 65536) return socket.destroy();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        socket.destroy();
      }
    }
  });
}

export function send(socket, message) {
  if (!socket.destroyed) socket.write(JSON.stringify(message) + "\n");
}
