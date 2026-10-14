"use client";

import { STREAK_MIN_DAYS } from "@/lib/streaks";

// The flame beside a name: how many days in a row that member has posted.
//
// Sized in em rather than pixels, so the same badge sits correctly next to a
// 13px username on a card, a 12px name in the comments, and the uppercase
// meta line on a profile — it always comes out a shade smaller than whatever
// it's standing next to, which is the point. It never renders below the
// threshold, so callers can hand it any number without checking first.

export default function StreakFlame({
  days,
  label = false,
  className = "",
}: {
  days: number;
  // Profile treatment: "5 DAY STREAK" spelled out, with only the number
  // burning and the words left in the same quiet grey as the post count above
  // them — the medal on the likes line has to stay the loudest thing there.
  // Everywhere else the number alone does the job; a name row has no room for
  // a sentence.
  label?: boolean;
  className?: string;
}) {
  if (days < STREAK_MIN_DAYS) return null;

  return (
    <span
      role="img"
      aria-label={`${days} day posting streak`}
      title={`${days} days in a row`}
      className={`inline-flex shrink-0 items-center align-middle ${
        label ? "gap-[3px]" : "gap-[2px]"
      } ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="streak-flame h-[1.05em] w-[1.05em] shrink-0 text-flame"
      >
        <path
          fill="currentColor"
          d="M12.6 1.5c.2 2.7 1.4 4.2 2.9 5.9 1.7 1.9 3 3.6 3 6.2a6.5 6.5 0 0 1-13 0c0-1.6.5-3 1.5-4.3.1 1.2.6 2 1.5 2.5-.5-3.6 1.4-7.4 4.1-10.3z"
        />
        {/* The bright core is what makes it read as fire rather than a
            raindrop at 12px — the same gold the daily-moment badge burns. */}
        <path
          fill="#ffd88a"
          d="M12.5 10.6c1.9 1.8 3.2 3.1 3.2 5a3.7 3.7 0 0 1-7.4 0c0-1.4.9-2.4 1.9-3.4.1.8.5 1.4 1.1 1.7-.4-1.3 0-2.4 1.2-3.3z"
        />
      </svg>
      {label ? (
        <span className="font-semibold leading-none text-mut">
          <span className="font-extrabold text-flame">{days}</span> DAY STREAK
        </span>
      ) : (
        <span className="text-[0.85em] font-extrabold leading-none text-flame">{days}</span>
      )}
    </span>
  );
}
