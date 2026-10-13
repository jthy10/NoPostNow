"use client";

import { useEffect, useState } from "react";
import { isPhone, isStandalone } from "@/lib/push";

// Rotating copy — index picks the message so consecutive strips differ.
const MESSAGES = [
  "Psst — try our app. You’re missing out.",
  "Get notified when your friends post. Add this to your Home Screen.",
  "This feed hits different as an app.",
  "Install steps are at the top of the feed. Takes 10 seconds.",
  "Add it once — updates arrive automatically. No app store, ever.",
];

// Thin strip slotted between posts for phone-browser users — styled like the
// feed's own separators so it reads as part of the feed, not an ad. Tapping
// scrolls to the install instructions up top. Hidden once they're in the PWA.
export default function FeedPromo({
  index,
  onScrollToTop,
}: {
  index: number;
  onScrollToTop: () => void;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time environment sniff on mount
    if (!isStandalone() && isPhone()) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <button
      onClick={onScrollToTop}
      className="block w-full border-b-[0.5px] border-field px-6 py-3.5 text-center"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[1.5px] text-mut">
        {MESSAGES[index % MESSAGES.length]}
      </span>
    </button>
  );
}
