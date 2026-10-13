#!/usr/bin/env node
// Runs a relay — the public server that gives home-hosted sites an address.
// Most people never need this: it is for whoever offers a relay to others.
//
//   sh nopostnow.sh relay setup     choose the domain and port, make access keys
//   sh nopostnow.sh relay           run it
//   sh nopostnow.sh relay key       make another access key
//
// See docs/RELAY.md for DNS and HTTPS.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readRelayConfig, startRelay } from "../relay/server.mjs";
import { appDir, ask, bold, choose, closePrompts, cyan, dim, green, red } from "./lib.mjs";

const dataDir = path.resolve(process.env.NOPOSTNOW_RELAY_DIR || path.join(appDir, "relay-data"));
const file = path.join(dataDir, "relay.json");
const command = process.argv[2] ?? "run";

function save(config) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

const newKey = () => crypto.randomBytes(18).toString("base64url");

try {
  if (command === "setup") {
    const before = fs.existsSync(file) ? readRelayConfig(dataDir) : null;
    console.log(`\n${bold("NoPostNow relay setup")}\n`);
    const domain = (
      await ask("Domain that sites will live under (sites become name.<domain>)", {
        fallback: before?.domain ?? "",
        check: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : "Enter a domain you control, for example sites.example.com"),
      })
    ).toLowerCase();
    const port = Number(
      await ask("Port for the relay to listen on (your HTTPS front forwards to it)", {
        fallback: String(before?.port ?? 8080),
        check: (v) => (/^\d+$/.test(v) && +v > 0 && +v < 65536 ? null : "Enter a port number."),
      })
    );
    const registration = await choose(
      "Who may claim a name?",
      [
        { label: "Only people I give an access key to", hint: "recommended", value: "key" },
        { label: "Anyone", value: "open" },
      ],
      before?.registration === "open" ? 1 : 0
    );
    const keys = before?.keys?.length ? before.keys : registration === "key" ? [newKey()] : [];
    save({ domain, host: before?.host ?? "127.0.0.1", port, registration, keys, maxSites: before?.maxSites ?? 500 });
    console.log(green(`\nSaved to ${file}`));
    if (registration === "key") console.log(`Access key to hand out: ${bold(keys[0])}`);
    console.log(`\nNext: point ${cyan(domain)} and ${cyan(`*.${domain}`)} at this machine and put HTTPS in front.\nThe steps are in ${cyan("docs/RELAY.md")}. Then run: ${cyan("sh nopostnow.sh relay")}\n`);
  } else if (command === "key") {
    const config = readRelayConfig(dataDir);
    const key = newKey();
    save({ ...config, registration: "key", keys: [...config.keys, key] });
    console.log(`New access key: ${bold(key)}\n${dim("Restart the relay for it to take effect.")}`);
  } else if (command === "run") {
    if (!fs.existsSync(file)) {
      console.error(red("This relay hasn't been set up yet.") + ` Run ${bold("sh nopostnow.sh relay setup")} first.`);
      process.exit(1);
    }
    const config = readRelayConfig(dataDir);
    const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");
    await startRelay({ dataDir, config, log: (line) => console.log(`${dim(stamp())}  ${line}`) });
    console.log(`\n  ${bold("NoPostNow relay")} for ${cyan(`*.${config.domain}`)}`);
    console.log(`  ${dim("Listening on")} http://${config.host}:${config.port}  ${dim(`· registration: ${config.registration}`)}\n`);
    await new Promise(() => {});
  } else {
    console.log("Usage: sh nopostnow.sh relay [setup | key]");
  }
} catch (err) {
  console.error(red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  closePrompts();
}
