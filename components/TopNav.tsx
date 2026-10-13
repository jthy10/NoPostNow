"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useAuth } from "@/lib/auth-context";
import { useUnseenNotifications } from "@/lib/notifications";
import { useUnreadThreadCount } from "@/lib/dms";
import { useMascotPreference } from "@/lib/mascot";
import Mascot from "@/components/Mascot";
import { site } from "@/lib/site";

// Fixed wordmark bar that hides on scroll-down, returns on scroll-up —
// same behavior as the original site. Right side: messages, people search,
// and the notification bell — the two badged with how many unread threads
// and how many things happened since you last looked.
export default function TopNav({
  scrollRef,
}: {
  scrollRef?: RefObject<HTMLElement | null>;
} = {}) {
  const [hidden, setHidden] = useState(false);
  // How far the mascot may travel: up to the buttons, or to the end of the
  // row on the signed-out nav where there are no buttons.
  const rowRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { user } = useAuth();
  const mascot = useMascotPreference(user?.uid);
  const unseen = useUnseenNotifications(user?.uid);
  const unreadDms = useUnreadThreadCount(user?.uid, user?.isAdmin);

  useEffect(() => {
    const scroller = scrollRef?.current;
    const scrollY = () => scroller?.scrollTop ?? window.scrollY;
    let last = scrollY();
    const onScroll = () => {
      const y = scrollY();
      setHidden(y > 52 && y > last);
      last = y;
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  return (
    <>
      <nav
        // pt-[env(safe-area-inset-top)] keeps the bar below the notch/Dynamic
        // Island when installed to the home screen (0 in normal browsers).
        className={`fixed inset-x-0 top-0 z-40 border-b-[0.5px] border-line bg-canvas pt-[env(safe-area-inset-top)] transition-transform duration-300 ${
          hidden ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        <div ref={rowRef} className="flex h-[52px] items-center justify-between px-5">
          {/* The mascot sits beside the wordmark rather than inside its link,
              so its playful tap action stays separate from "go to feed." */}
          {/* No gap: the mascot's own left margin inside its view box already
              leaves about 7px of air between it and the T. */}
          <div className="flex items-center">
            <Link
              href="/"
              aria-label="Go to feed"
              onClick={() => {
                if (pathname !== "/") return;
                const scroller = scrollRef?.current;
                if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
                else window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="text-xl font-black tracking-[-0.5px]"
            >
              {site().siteName}
            </Link>
            {/* No vertical nudge — every animal shares the same ground line. */}
            <Mascot
              animal={mascot}
              stopBeforeRef={buttonsRef}
              rowRef={rowRef}
            />
          </div>

          {user && (
            <div ref={buttonsRef} className="-mr-1.5 flex items-center gap-1">
              <Link
                href="/dm"
                aria-label={
                  unreadDms > 0 ? `Messages, ${unreadDms} unread` : "Messages"
                }
                className="relative p-1.5 text-white transition-opacity active:opacity-60"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[22px] w-[22px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                {unreadDms > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-heart px-1 text-[10px] font-extrabold leading-none text-white">
                    {unreadDms > 99 ? "99+" : unreadDms}
                  </span>
                )}
              </Link>
              <Link
                href="/search"
                aria-label="Search people"
                className="p-1.5 text-white transition-opacity active:opacity-60"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[22px] w-[22px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </Link>

              <Link
                href="/notifications"
                aria-label={
                  unseen > 0 ? `Notifications, ${unseen} unseen` : "Notifications"
                }
                className="relative p-1.5 text-white transition-opacity active:opacity-60"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[22px] w-[22px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unseen > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-heart px-1 text-[10px] font-extrabold leading-none text-white">
                    {unseen > 99 ? "99+" : unseen}
                  </span>
                )}
              </Link>
            </div>
          )}
        </div>
      </nav>
      {/* Opaque backing for the status bar: when the nav hides on scroll,
          photos would otherwise slide under the clock/battery and make them
          unreadable. Height is 0 outside installed/notched contexts. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top)] bg-canvas" />
    </>
  );
}
