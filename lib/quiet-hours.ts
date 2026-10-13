// Quiet hours: a per-user window during which push notifications stay
// silent. Stored as minutes-since-midnight in the user's own timezone
// (captured from the browser when they save), so the window follows the
// wall clock through DST. Pure and isomorphic — evaluated by the notify
// API routes on the server and previewed by the settings UI.

export function minutesNowIn(tz: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return (get("hour") % 24) * 60 + get("minute");
  } catch {
    // Unknown/corrupt tz string — treat as UTC rather than throwing.
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

// start === end means "off" (a zero-length window); a window that crosses
// midnight (start > end) wraps, e.g. 22:00 → 08:00.
export function inQuietHours(
  quietStart: number | null | undefined,
  quietEnd: number | null | undefined,
  tz: string | null | undefined,
  at: Date = new Date()
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
  const now = minutesNowIn(tz || "America/New_York", at);
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
