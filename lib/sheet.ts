"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// iOS Safari overlays the on-screen keyboard on top of the layout viewport,
// so position:fixed bottom sheets stay buried underneath it. Tracks how many
// px of the layout viewport the keyboard covers (0 when closed) plus the
// visible height, so sheets can lift themselves above the keyboard.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  const [visibleHeight, setVisibleHeight] = useState(0);
  const closedHeight = useRef<number | null>(null);
  const closedCovered = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let settleTimer: number | undefined;

    const hasEditableFocus = () => {
      const active = document.activeElement;
      return (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      );
    };

    const coveredHeight = () =>
      Math.max(0, window.innerHeight - vv.height - vv.offsetTop);

    const recordClosedViewport = () => {
      closedHeight.current = vv.height;
      closedCovered.current = coveredHeight();
    };

    const update = () => {
      const covered = coveredHeight();
      const editing = hasEditableFocus();
      if (!editing) {
        setInset(0);
        window.clearTimeout(settleTimer);
        if (closedHeight.current === null) {
          // Capture the initial closed viewport immediately.
          recordClosedViewport();
        } else {
          // focusout precedes the keyboard's closing animation. Wait until
          // visualViewport events settle before replacing the closed baseline.
          settleTimer = window.setTimeout(() => {
            if (!hasEditableFocus()) recordClosedViewport();
          }, 250);
        }
      } else {
        window.clearTimeout(settleTimer);
        const heightLoss = Math.max(0, (closedHeight.current ?? vv.height) - vv.height);
        const keyboardCover = Math.max(0, covered - closedCovered.current);
        // iOS can keep an input focused after dismissing the keyboard. Only a
        // real viewport contraction should lift the composer or a sheet.
        setInset(heightLoss >= 120 && keyboardCover >= 80 ? keyboardCover : 0);
      }
      setVisibleHeight(vv.height);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      window.clearTimeout(settleTimer);
    };
  }, []);

  return { inset, visibleHeight };
}

// Swipe-down-to-dismiss for bottom sheets. Returns a ref for the sheet
// element plus the live drag offset so the sheet can follow the finger.
// Uses native (non-passive) touch listeners — React's synthetic touchmove
// is passive, so it can't preventDefault the inner scroll once a drag
// takes over. A drag only begins when the finger moves down past a small
// slop AND the scrollable area (scrollRef, defaulting to the sheet itself)
// is already at the top — otherwise the list scrolls normally.
export function useSwipeDismiss(
  onDismiss: () => void,
  {
    scrollRef,
    enabled = true,
  }: { scrollRef?: RefObject<HTMLElement | null>; enabled?: boolean } = {}
) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !enabled) return;

    let startY = 0;
    let dy = 0;
    let lastY = 0;
    let lastT = 0;
    let vel = 0; // px/ms, downward positive
    let active = false;
    let committed = false;

    const start = (e: TouchEvent) => {
      // Touches on form fields keep their native behavior (caret, selection).
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      active = true;
      committed = false;
      dy = 0;
      vel = 0;
      startY = lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
    };

    const move = (e: TouchEvent) => {
      if (!active) return;
      const y = e.touches[0].clientY;
      dy = y - startY;
      if (e.timeStamp > lastT) vel = (y - lastY) / (e.timeStamp - lastT);
      lastY = y;
      lastT = e.timeStamp;

      if (!committed) {
        if (dy < -8) {
          active = false; // moving up — it's a scroll, not a dismiss
          return;
        }
        if (dy < 8) return; // within slop, wait
        const sc = scrollRef?.current ?? el;
        if (sc.contains(e.target as Node) && sc.scrollTop > 0) {
          active = false; // list is mid-scroll — let it scroll back up
          return;
        }
        committed = true;
        (document.activeElement as HTMLElement | null)?.blur?.(); // drop the keyboard
        setDragging(true);
      }
      e.preventDefault();
      setDragY(Math.max(0, dy));
    };

    const end = () => {
      if (!active) return;
      active = false;
      if (!committed) return;
      committed = false;
      setDragging(false);
      const h = el.offsetHeight || 400;
      if (dy > Math.min(h * 0.35, 160) || vel > 0.5) dismissRef.current();
      else setDragY(0); // spring back
    };

    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [enabled, scrollRef]);

  return { sheetRef, dragY, dragging };
}

// Esc closes the sheet — desktop nicety.
export function useEscapeToClose(onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// Freeze the page behind an open sheet — iOS otherwise scrolls the body when
// the keyboard opens, leaving the feed in a random spot after closing.
export function useBodyScrollLock() {
  useEffect(() => {
    const y = window.scrollY;
    const s = document.body.style;
    s.position = "fixed";
    s.top = `-${y}px`;
    s.left = "0";
    s.right = "0";
    s.width = "100%";
    return () => {
      s.position = "";
      s.top = "";
      s.left = "";
      s.right = "";
      s.width = "";
      window.scrollTo(0, y);
    };
  }, []);
}
