#!/usr/bin/env node
// Starts the site using the address and port chosen during setup.
//   npm start        production (run `npm run build` first)
//   npm run dev      development, with live reload
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { hasConfig, readConfig, resolveDataDir } from "../server/core/config.ts";
import { appDir, bold, cyan, dim, red, yellow } from "./lib.mjs";

const dev = process.argv.includes("--dev");
const dataDir = resolveDataDir(appDir);

if (!hasConfig(dataDir)) {
  console.error(red("This copy hasn't been set up yet.") + ` Run ${bold("npm run setup")} first.`);
  process.exit(1);
}
if (!dev && !fs.existsSync(path.join(appDir, ".next", "BUILD_ID"))) {
  console.error(red("The site hasn't been built yet.") + ` Run ${bold("npm run build")} first.`);
  process.exit(1);
}

const config = readConfig(dataDir);

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

console.log(`\n  ${bold(config.siteName)} ${dim(dev ? "(development)" : "")}`);
console.log(`  ${dim("On this computer:")}  ${cyan(`http://localhost:${config.port}`)}`);
if (config.host === "0.0.0.0") {
  for (const ip of lanAddresses()) {
    console.log(`  ${dim("On your network:")}   ${cyan(`http://${ip}:${config.port}`)}`);
  }
}
if (config.publicUrl) console.log(`  ${dim("Public address:")}    ${cyan(config.publicUrl)}`);
else console.log(`  ${yellow("Not online yet.")} ${dim("See docs/GOING-ONLINE.md to share it with friends.")}`);
console.log(`  ${dim("Data folder:")}       ${dataDir}\n`);

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [nextBin, dev ? "dev" : "start", "-p", String(config.port), "-H", config.host],
  {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, NOPOSTNOW_DATA_DIR: dataDir },
  }
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
