import fs from "node:fs";
import path from "node:path";

// Everything a host chooses lives in one JSON file inside the data folder, so
// backing up (or moving) an instance is copying a single directory. The app
// folder itself holds only a tiny pointer file saying where that directory is.
//
// This module is imported by both the Next.js server and the plain-Node setup
// scripts, so it sticks to erasable TypeScript and explicit .ts import paths.

export type DailyMoment = {
  enabled: boolean;
  // 24-hour wall-clock time, "HH:MM", in the site's time zone.
  time: string;
  // Also light up the matching minute twelve hours away (07:30 and 19:30).
  bothHalves: boolean;
  // Optional "MM-DD": every photo posted that day gets the special badge.
  specialDate: string;
};

export type SiteConfig = {
  siteName: string;
  tagline: string;
  // Hex colour used for hearts, badges and highlights.
  accent: string;
  host: string;
  port: number;
  // Public address once the instance is online, e.g. https://photos.example.com
  publicUrl: string;
  // Who may create an account: with an invite link, anyone, or nobody.
  signup: "invite" | "open" | "closed";
  // The clock the whole group shares: posting streaks, the daily moment and
  // the special date are all judged by it, wherever a member happens to be.
  timeZone: string;
  dailyMoment: DailyMoment;
  // Set when the host accepts the terms during setup.
  termsAcceptedAt: string;
  vapid: { publicKey: string; privateKey: string; subject: string };
};

export const POINTER_FILE = "nopostnow.json";
export const CONFIG_FILE = "config.json";

export const DEFAULT_CONFIG: SiteConfig = {
  siteName: "NoPostNow",
  tagline: "A private photo feed for your friends",
  accent: "#ff3b5c",
  host: "0.0.0.0",
  port: 3000,
  publicUrl: "",
  signup: "invite",
  timeZone: "America/New_York",
  dailyMoment: {
    enabled: false,
    time: "19:00",
    bothHalves: false,
    specialDate: "",
  },
  termsAcceptedAt: "",
  vapid: { publicKey: "", privateKey: "", subject: "" },
};

// Where the data folder lives: an explicit environment variable wins, then the
// pointer file the setup wizard writes, then ./data next to the app.
export function resolveDataDir(appDir: string = process.cwd()): string {
  const fromEnv = process.env.NOPOSTNOW_DATA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(appDir, POINTER_FILE), "utf8"));
    if (typeof pointer.dataDir === "string" && pointer.dataDir) {
      return path.resolve(appDir, pointer.dataDir);
    }
  } catch {
    // No pointer yet — fall through to the default.
  }
  return path.join(appDir, "data");
}

export function writePointer(appDir: string, dataDir: string) {
  fs.writeFileSync(
    path.join(appDir, POINTER_FILE),
    JSON.stringify({ dataDir }, null, 2) + "\n"
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function str(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

// A hand-edited or partial file must never take the server down, so every
// field is validated on its own and falls back to the default.
export function normalizeConfig(raw: unknown): SiteConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  const m = (r.dailyMoment && typeof r.dailyMoment === "object" ? r.dailyMoment : {}) as Record<
    string,
    unknown
  >;
  const v = (r.vapid && typeof r.vapid === "object" ? r.vapid : {}) as Record<string, unknown>;
  const port = Number(r.port);
  const publicUrl = str(r.publicUrl, "", 300).replace(/\/+$/, "");
  return {
    siteName: str(r.siteName, d.siteName, 40),
    tagline: str(r.tagline, d.tagline, 120),
    accent: typeof r.accent === "string" && HEX.test(r.accent) ? r.accent.toLowerCase() : d.accent,
    host: str(r.host, d.host, 100),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : d.port,
    publicUrl: /^https?:\/\//.test(publicUrl) ? publicUrl : "",
    signup: r.signup === "open" || r.signup === "closed" ? r.signup : "invite",
    timeZone:
      typeof r.timeZone === "string" && isValidTimeZone(r.timeZone) ? r.timeZone : d.timeZone,
    dailyMoment: {
      enabled: m.enabled === true,
      time: typeof m.time === "string" && TIME.test(m.time) ? m.time : d.dailyMoment.time,
      bothHalves: m.bothHalves === true,
      specialDate:
        typeof m.specialDate === "string" && MONTH_DAY.test(m.specialDate) ? m.specialDate : "",
    },
    termsAcceptedAt: str(r.termsAcceptedAt, "", 40),
    vapid: {
      publicKey: str(v.publicKey, "", 200),
      privateKey: str(v.privateKey, "", 200),
      subject: str(v.subject, "", 200),
    },
  };
}

export function readConfig(dataDir: string): SiteConfig {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(path.join(dataDir, CONFIG_FILE), "utf8")));
  } catch {
    return normalizeConfig({});
  }
}

export function hasConfig(dataDir: string): boolean {
  return fs.existsSync(path.join(dataDir, CONFIG_FILE));
}

export function writeConfig(dataDir: string, config: SiteConfig) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, CONFIG_FILE);
  // The file holds the push signing key, so keep it private to the host user
  // where the platform supports file modes (Windows ignores the mode).
  fs.writeFileSync(file, JSON.stringify(normalizeConfig(config), null, 2) + "\n", { mode: 0o600 });
}

// The slice of the config that is safe to hand to a browser.
export type PublicSite = {
  siteName: string;
  tagline: string;
  accent: string;
  signup: SiteConfig["signup"];
  timeZone: string;
  dailyMoment: DailyMoment;
  vapidPublicKey: string;
};

export function publicSite(config: SiteConfig): PublicSite {
  return {
    siteName: config.siteName,
    tagline: config.tagline,
    accent: config.accent,
    signup: config.signup,
    timeZone: config.timeZone,
    dailyMoment: config.dailyMoment,
    vapidPublicKey: config.vapid.publicKey,
  };
}
