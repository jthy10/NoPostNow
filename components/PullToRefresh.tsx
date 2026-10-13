"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const TRIGGER = 60; // translated px needed to fire a refresh
const MAX = 90;
const HOLD = 52; // where the content rests while refreshing

// Custom pull-to-refresh: installed PWAs have no browser reload UI at all.
// Wraps the page's <main> only — a CSS transform on an ancestor would break
// position:fixed descendants like the navs, so those must stay outside.
export default function PullToRefresh({
  onRefresh,
  scrollRef,
  children,
}: {
  onRefresh: () => Promise<void>;
  scrollRef?: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const cbRef = useRef(onRefresh);
  useEffect(() => {
    cbRef.current = onRefresh;
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let startY = 0;
    let active = false;
    const scrollTop = () => scrollRef?.current?.scrollTop ?? window.scrollY;

    function onStart(e: TouchEvent) {
      // Only arm when the page is already at the very top.
      if (scrollTop() > 0 || pullRef.current > 0) return;
      startY = e.touches[0].clientY;
      active = true;
    }

    function onMove(e: TouchEvent) {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || scrollTop() > 0) {
        pullRef.current = 0;
        setPull(0);
        setDragging(false);
        return;
      }
      // Take over from the native rubber-band while pulling.
      e.preventDefault();
      const next = Math.min(dy * 0.45, MAX);
      pullRef.current = next;
      setDragging(true);
      setPull(next);
    }

    async function onEnd() {
      if (!active) return;
      active = false;
      setDragging(false);
      if (pullRef.current >= TRIGGER) {
        pullRef.current = HOLD;
        setPull(HOLD);
        setRefreshing(true);
        try {
          await cbRef.current();
        } finally {
          setRefreshing(false);
          pullRef.current = 0;
          setPull(0);
        }
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    }

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scrollRef]);

  const armed = pull >= TRIGGER;

  return (
    <div
      ref={wrapRef}
      className="relative"
      style={{
        transform: pull > 0 ? `translateY(${pull}px)` : undefined,
        transition: dragging ? "none" : "transform 0.25s ease-out",
      }}
    >
      {/* Spinner sits in the gap the content is pulled away from. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 flex justify-center"
        style={{ top: -40, opacity: refreshing ? 1 : Math.min(pull / TRIGGER, 1) }}
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-6 w-6 text-mut ${refreshing ? "animate-spin" : ""}`}
          style={
            refreshing ? undefined : { transform: `rotate(${(pull / TRIGGER) * 270}deg)` }
          }
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          {armed && !refreshing && <polyline points="21 2 21 6 17 6" />}
        </svg>
      </div>
      {children}
    </div>
  );
}
