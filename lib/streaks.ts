"use client";

import { useMemo } from "react";
import { useArchive } from "./feed-cache";
import { badgeDate, type Post } from "./posts";
import { wallClock } from "./site";

// Posting streaks — how many days in a row a member has posted, shown as a
// flame beside their name.
//
// Like the like standings next door, nothing counts this server-side: a
// streak is just a shape in the timestamps, so it's derived on the client
// from the same whole-archive read /browse and the podium already share
// (lib/feed-cache). That also means a streak can never go stale or need
// repairing — a missed day breaks it by simply not being there, with no
// nightly job to run and nothing to reset.

// Two days in a row is a coincidence; three is a habit. Nothing shows below
// this — the flame has to mean something the first time you see it.
export const STREAK_MIN_DAYS = 3;

// Which day a post belongs to, as a whole number of days since the epoch, read
// off the site's clock — the same clock the daily moment is judged by (see
// lib/site.ts).
//
// One shared zone rather than each viewer's own matters here: a streak is one
// number attached to a person, so counting it locally would let the same
// member's flame read 4 for one friend and 5 for another, and their profile
// disagree with the flame beside their name in someone else's feed.
function siteDay(at: Date): number {
  const { year, month, day } = wallClock(at);
  // Consecutive days differ by exactly 1 in this form — no month-end, leap
  // year or DST arithmetic left to get wrong.
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function siteToday(now: Date = new Date()): number {
  return siteDay(now);
}

// Days in a row, counting back from today. Today itself is optional: the
// streak you went to bed on is still yours until the day is actually over, so
// it holds all day and only breaks once a whole day has gone by with nothing
// posted. Anything else would show everyone a broken flame every morning.
export function countStreak(days: Set<number>, today: number): number {
  let day = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  if (day === null) return 0;
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day--;
  }
  return streak;
}

// uid -> streak, for everyone currently on one worth showing. Members below
// the threshold are left out entirely, so a caller can render whatever it
// finds without re-checking the rule.
export function streaksFrom(posts: Post[], today: number): Map<string, number> {
  const daysByAuthor = new Map<string, Set<number>>();
  for (const post of posts) {
    const author = post.userUUID;
    // A post with no owner belongs to nobody's streak.
    if (!author) continue;
    // badgeDate is the instant the card itself is stamped with, so the flame
    // counts exactly the days the feed says someone posted on.
    const at = badgeDate(post);
    if (!at) continue;
    const day = siteDay(at);
    if (day > today) continue; // a device clock running fast can't post ahead
    const mine = daysByAuthor.get(author);
    if (mine) mine.add(day);
    else daysByAuthor.set(author, new Set([day]));
  }

  const streaks = new Map<string, number>();
  for (const [author, days] of daysByAuthor) {
    const streak = countStreak(days, today);
    if (streak >= STREAK_MIN_DAYS) streaks.set(author, streak);
  }
  return streaks;
}

// Every mounted card asks for the streaks, and they all read the same cached
// archive — so hold the last tally and hand back the very same Map rather
// than counting 500-odd posts again per card. Keyed by the array identity
// (the cache hands out one copy) and by the day, so a session left open past
// midnight recounts instead of showing yesterday's flames.
const EMPTY: Map<string, number> = new Map();
let memoPosts: Post[] | null = null;
let memoToday = -1;
let memoStreaks: Map<string, number> = EMPTY;

function tally(posts: Post[]): Map<string, number> {
  const today = siteToday();
  if (posts !== memoPosts || today !== memoToday) {
    memoPosts = posts;
    memoToday = today;
    memoStreaks = streaksFrom(posts, today);
  }
  return memoStreaks;
}

export function useStreaks(uid: string | undefined): Map<string, number> {
  const posts = useArchive(Boolean(uid));
  return useMemo(() => (posts ? tally(posts) : EMPTY), [posts]);
}
