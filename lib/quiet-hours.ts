// Quiet hours: a per-user window during which push notifications stay
// silent. Stored as minutes-since-midnight in the user's own timezone
// (captured from the browser when they save), so the window follows the
// wall clock through DST. Pure and isomorphic — evaluated by the notify
// API routes on the server and previewed by the settings UI.

// A member's saved zone, read on their behalf. A missing or unusable one
// falls back to the site's own zone, the same answer either way, so a corrupt
// string can't silently shift someone's window by hours.
export function minutesNowIn(tz: string, at: Date = new Date(), fallbackTz = "UTC"): number {
  try {
    return minutesIn(tz, at);
  } catch {
    try {
      return minutesIn(fallbackTz, at);
    } catch {
      return at.getUTCHours() * 60 + at.getUTCMinutes();
    }
  }
}

function minutesIn(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return (get("hour") % 24) * 60 + get("minute");
}

// start === end means "off" (a zero-length window); a window that crosses
// midnight (start > end) wraps, e.g. 22:00 → 08:00.
export function inQuietHours(
  quietStart: number | null | undefined,
  quietEnd: number | null | undefined,
  tz: string | null | undefined,
  at: Date = new Date(),
  fallbackTz = "UTC"
): boolean {
  if (
    typeof quietStart !== "number" ||
    typeof quietEnd !== "number" ||
    quietStart === quietEnd ||
    quietStart < 0 ||
    quietEnd < 0 ||
    quietStart > 1439 ||
    quietEnd > 1439
  ) {
    return false;
  }
  const now = minutesNowIn(tz || fallbackTz, at, fallbackTz);
  return quietStart < quietEnd
    ? now >= quietStart && now < quietEnd
    : now >= quietStart || now < quietEnd;
}

export function formatMinutes(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
