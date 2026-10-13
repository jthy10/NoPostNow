"use client";

import { useMemo } from "react";
import { useArchive } from "./feed-cache";
import { useBlockSets } from "./blocks";
import type { Post } from "./posts";

// How many likes a member has collected, and who's on the podium for it.
//
// Nothing tallies this server-side — a like is just a uid sitting inside a
// post's likedBy array — so the totals are summed on the client from the same
// whole-archive read /browse already does. It's session-cached and persisted
// (lib/feed-cache), so whichever page asks first pays for it and every
// profile after that, plus Browse, is free.

export const PODIUM_PLACES = 3;

// The like count a card actually shows subtracts hidden uids (see PhotoCard's
// visibleLikes) — a blocked person must not be visible by subtraction. So the
// profile total has to subtract them too, or the header and the hearts under
// the photos below it would disagree.
export function countLikes(posts: Post[], hidden: Set<string>): number {
  let total = 0;
  for (const post of posts) {
    const likes = post.likedBy;
    if (!likes?.length) continue;
    total += hidden.size ? likes.filter((uid) => !hidden.has(uid)).length : likes.length;
  }
  return total;
}

// uid -> podium place (1, 2 or 3), for everyone who has one. Competition
// ranking, so a tie for the most likes puts the whole tie on gold and skips
// the places it used up — two firsts, then a third, no silver.
//
// Zero likes never medals, and blocked members are left out of the reckoning
// entirely: blocking is mutual invisibility, so the podium should only ever
// name people this viewer can actually see.
export function usePodium(uid: string | undefined): Map<string, number> {
  const { hidden } = useBlockSets(uid);
  const posts = useArchive(Boolean(uid));

  return useMemo(() => {
    const podium = new Map<string, number>();
    if (!posts) return podium;

    // A post with no owner contributes to nobody's total.
    const byAuthor = new Map<string, Post[]>();
    for (const post of posts) {
      const author = post.userUUID;
      if (!author || hidden.has(author)) continue;
      const mine = byAuthor.get(author);
      if (mine) mine.push(post);
      else byAuthor.set(author, [post]);
    }
    // Totalled through countLikes — the same function the profile header
    // displays — so a medal can never disagree with the number it sits on.
    const totals = new Map(
      [...byAuthor].map(([author, mine]) => [author, countLikes(mine, hidden)] as const)
    );

    // Descending, so a total's first index is exactly how many members beat
    // it — competition ranking without a special case for ties.
    const ranked = [...totals.values()].filter((n) => n > 0).sort((a, b) => b - a);
    for (const [author, likes] of totals) {
      if (likes <= 0) continue;
      const place = ranked.indexOf(likes) + 1;
      if (place <= PODIUM_PLACES) podium.set(author, place);
    }
    return podium;
  }, [posts, hidden]);
}
