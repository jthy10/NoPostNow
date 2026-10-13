// Shared by the command-line tools: finding the app folder, opening the data
// folder, and asking questions in the terminal.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  hasConfig,
  readConfig,
  resolveDataDir,
} from "../server/core/config.ts";
import { openDatabase } from "../server/core/db.ts";

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function openInstance() {
  const dataDir = resolveDataDir(appDir);
  return {
    dataDir,
    configured: hasConfig(dataDir),
    config: hasConfig(dataDir) ? readConfig(dataDir) : DEFAULT_CONFIG,
    db: openDatabase(dataDir),
  };
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const bold = paint("1");
export const dim = paint("2");
export const red = paint("31");
export const green = paint("32");
export const yellow = paint("33");
export const cyan = paint("36");

// Lines are read through one queue so answers piped in from a file or another
// program work exactly like answers typed at the keyboard.
let rl = null;
const pending = [];
const waiting = [];
let closed = false;

function input() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else pending.push(line);
  });
  rl.on("close", () => {
    closed = true;
    for (const next of waiting.splice(0)) next(null);
  });
  return rl;
}

function readLine() {
  input();
  if (pending.length) return Promise.resolve(pending.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

export function closePrompts() {
  rl?.close();
}

// Asks until the answer passes `check` (which returns an error message, or
// nothing when the answer is fine). Enter accepts the default.
export async function ask(question, { fallback = "", check, secret = false } = {}) {
  for (;;) {
    process.stdout.write(`${question}${fallback ? dim(` [${fallback}]`) : ""}: `);
    const hide = secret && process.stdin.isTTY;
    if (hide) process.stdin.setRawMode?.(false), process.stdout.write("\x1b[8m");
    const line = await readLine();
    if (hide) process.stdout.write("\x1b[0m");
    if (line === null) {
      process.stdout.write("\n");
      throw new Error("Input ended before setup was finished.");
    }
    const answer = line.trim() || fallback;
    const problem = check?.(answer);
    if (!problem) return answer;
    console.log(red(`  ${problem}`));
  }
}

export async function confirm(question, fallback = true) {
  const answer = await ask(`${question} ${dim(fallback ? "(Y/n)" : "(y/N)")}`, {
    check: (a) => (a && !/^(y|yes|n|no)$/i.test(a) ? "Answer y or n." : null),
  });
  return answer ? /^y/i.test(answer) : fallback;
}

// Numbered menu. Returns the chosen option's value.
export async function choose(question, options, fallbackIndex = 0) {
  console.log(question);
  options.forEach((o, i) => console.log(`  ${bold(String(i + 1))}. ${o.label}${o.hint ? dim(` — ${o.hint}`) : ""}`));
  const answer = await ask("  Choose", {
    fallback: String(fallbackIndex + 1),
    check: (a) => (/^\d+$/.test(a) && +a >= 1 && +a <= options.length ? null : `Enter a number from 1 to ${options.length}.`),
  });
  return options[Number(answer) - 1].value;
}

export function exists(file) {
  return fs.existsSync(file);
}
