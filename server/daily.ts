import { wallClock } from "../lib/site.ts";
import { sendPush } from "./push.ts";
import { config, db } from "./runtime.ts";

// The daily moment: one push to everyone at the time the host picked, as a
// nudge to post what they are up to. Runs inside the server process — there
// is no outside scheduler to configure.

// A different line each day, in order, so everyone counts through the list
// together. "{time}" becomes the moment itself.
const MESSAGES = [
  "It's {time} — time to post!",
  "Happy {time}! Celebrate with a photo.",
  "The clock says {time}. You know what to do.",
  "{time} check-in: show us what you're up to.",
  "Your daily {time} has arrived.",
  "What does {time} look like where you are?",
  "One photo. Right now. Go.",
  "Quick — capture the vibe.",
  "Drop what you're doing. Actually, photograph it.",
  "No filters — just right now.",
  "Today's memory starts now.",
  "It's officially posting o'clock.",
  "Roll call: where is everybody?",
  "Don't let today disappear.",
  "Show, don't tell.",
  "The {time} window is open.",
  "Current situation? We need photographic evidence.",
  "{time} just hit. Feed the feed.",
  "Your future recap needs this photo.",
  "The group camera roll is calling.",
  "This is your sign to post.",
  "A moment from your day belongs here.",
  "What's happening right now?",
  "Stop scrolling. Start posting.",
  "Another day, another {time}.",
  "You had to be there — so show us.",
  "The best photo is whatever's in front of you.",
  "Make {time} history.",
];

const KEY = "daily:lastDay";

function dayNumber(now: Date, timeZone: string): number {
  const { year, month, day } = wallClock(now, timeZone);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

// How long after the chosen minute the reminder may still go out, so a host
// that was asleep or busy through that minute does not skip the whole day.
const LATE_MINUTES = 10;

// Called a few times a minute. Sends at most once per day.
export async function tickDailyMoment(now: Date = new Date()) {
  const { dailyMoment, timeZone, siteName } = config();
  if (!dailyMoment.enabled) return;
  const [hour, minute] = dailyMoment.time.split(":").map(Number);
  const clock = wallClock(now, timeZone);
  const late = clock.hour * 60 + clock.minute - (hour * 60 + minute);
  if (late < 0 || late > LATE_MINUTES) return;

  const today = dayNumber(now, timeZone);
  const last = db().prepare("SELECT value FROM kv WHERE key = ?").get(KEY) as
    | { value: string }
    | undefined;
  if (last && Number(last.value) === today) return;
  // Marked before sending, so a slow push service can't cause a second round.
  db()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(KEY, String(today));

  const label = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")}`;
  await sendPush({
    kind: "daily",
    payload: {
      title: siteName,
      body: MESSAGES[today % MESSAGES.length].replaceAll("{time}", label),
      url: "/",
      tag: "daily-moment",
    },
  });
}
