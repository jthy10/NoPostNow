import type { PublicSite } from "@/server/core/config";

// The host's choices — name, colour, sign-up mode, daily moment — as the
// browser sees them. The root layout reads them from the config file on every
// request and SiteProvider publishes them here before anything else renders,
// so plain modules (not just components) can read them.

export type { PublicSite };

let current: PublicSite = {
  siteName: "NoPostNow",
  tagline: "A private photo feed for your friends",
  accent: "#ff3b5c",
  signup: "invite",
  timeZone: "America/New_York",
  dailyMoment: { enabled: false, time: "19:00", bothHalves: false, specialDate: "" },
  vapidPublicKey: "",
};

export function setSite(next: PublicSite) {
  current = next;
}

export function site(): PublicSite {
  return current;
}

// The shared line every member has to the people running the site.
export function adminChatName() {
  return `${current.siteName} Admins`;
}

// Replies are signed with the role, never with the account behind it.
export function adminSenderName() {
  return `${current.siteName} Admin`;
}

// --- the group's clock -------------------------------------------------------

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

// What the site's clock read at a given instant.
export function wallClock(at: Date, timeZone: string = current.timeZone): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

function momentParts() {
  const [hour, minute] = current.dailyMoment.time.split(":").map(Number);
  return { hour, minute };
}

// Did the site's clock read the daily moment at this instant?
export function readsDailyMoment(at: Date): boolean {
  const moment = current.dailyMoment;
  if (!moment.enabled) return false;
  const want = momentParts();
  const now = wallClock(at);
  if (now.minute !== want.minute) return false;
  return moment.bothHalves ? now.hour % 12 === want.hour % 12 : now.hour === want.hour;
}

// Is this instant on the host's special date (an anniversary, say)?
export function isSpecialDate(at: Date): boolean {
  const special = current.dailyMoment.specialDate;
  if (!current.dailyMoment.enabled || !special) return false;
  const [month, day] = special.split("-").map(Number);
  const now = wallClock(at);
  return now.month === month && now.day === day;
}

// "7:30" — how the moment is written on badges and in settings.
export function dailyMomentLabel(): string {
  const { hour, minute } = momentParts();
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")}`;
}

// "7:30 PM" — when the daily reminder goes out.
export function dailyMomentTime(): string {
  const { hour } = momentParts();
  return `${dailyMomentLabel()} ${hour < 12 ? "AM" : "PM"}`;
}

// "6/21" — the special date as month/day.
export function specialDateLabel(): string {
  const [month, day] = current.dailyMoment.specialDate.split("-").map(Number);
  return month && day ? `${month}/${day}` : "";
}
