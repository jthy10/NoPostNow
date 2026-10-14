// The "TODAY 3:42 PM" / "YESTERDAY 3:42 PM" / "JUL 4, 3:42 PM" stamp shared by
// post cards, DM threads and the admin chat, in the viewer's own clock.
//
// Days are counted from calendar fields rather than by dividing a millisecond
// gap by 24h: across a daylight-saving change "yesterday" is 23 or 25 hours
// back, so the division lands on 0.96 or 1.04 and never matches 1.
function calendarDay(x: Date): number {
  return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000;
}

export function stampLabel(d: Date, now: Date = new Date()): string {
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
  const dayDiff = calendarDay(now) - calendarDay(d);
  if (dayDiff === 0) return `TODAY ${time}`;
  if (dayDiff === 1) return `YESTERDAY ${time}`;
  const date = d
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    })
    .toUpperCase();
  return `${date}, ${time}`;
}
