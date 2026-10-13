"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

// Windowing for long lists whose rows are tall, variable, and not measurable
// up front — the archive is hundreds of photos of different shapes.
//
// Rendering them all keeps every photo's decoded blob alive at once (see the
// reference-counted cache in use-authed-image): the browser can't drop what's
// still in the DOM. Windowing keeps only the rows near the viewport mounted,
// so scrolling past 500 photos holds ~10 instead of 500, and the rest are
// released.
//
// Heights work in two passes. Each row starts at whatever `estimate` says —
// for a photo that's near-exact, since posts store their image dimensions —
// and is replaced by its real measured height once it has been on screen.
// Correcting a row above the viewport would yank the page, so the scroll
// position is anchored to the topmost visible row and compensated whenever
// that row's offset moves.

type Options<T> = {
  items: T[];
  getKey: (item: T) => string;
  // Best guess at a row's height before it has ever been measured, given the
  // current content width. Closer estimates mean less scroll correction.
  estimate: (item: T, width: number) => number;
  // The scrolling element the list lives inside. Passed as the element itself,
  // not a ref: pages render a loading screen first, so the scroller doesn't
  // exist on the first render, and a ref object's identity never changes to
  // tell us it finally showed up. Hold it in state (`ref={setEl}`) instead.
  scrollEl: HTMLElement | null;
  // The element wrapping the rendered rows. Each row must be a direct child
  // carrying data-vkey={key} so it can be measured. Owned by the caller so
  // nothing ref-shaped comes back out of here into render.
  containerRef: RefObject<HTMLElement | null>;
  // Rows to keep mounted beyond each edge of the viewport.
  overscan?: number;
};

export type VirtualList<T> = {
  // Rows to render, in order, with the index they hold in the full list.
  visible: { item: T; index: number; key: string }[];
  // Total scrollable height, so the scrollbar matches the whole list.
  totalHeight: number;
  // How far down the first rendered row sits.
  offsetTop: number;
};

export function useVirtualList<T>({
  items,
  getKey,
  estimate,
  scrollEl,
  containerRef,
  overscan = 3,
}: Options<T>): VirtualList<T> {
  // Real heights live in state, not a ref: they feed the render directly, so
  // reading them during render has to be pure.
  const [measured, setMeasured] = useState<Map<string, number>>(() => new Map());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ height: 0, width: 0 });

  // Track the scroller: its size decides how many rows fit and how wide they
  // are (width feeds the estimates), its scrollTop decides which rows those are.
  useLayoutEffect(() => {
    if (!scrollEl) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return; // coalesce to one update per frame
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(scrollEl.scrollTop);
      });
    };
    const sync = () => {
      setViewport({ height: scrollEl.clientHeight, width: scrollEl.clientWidth });
      setScrollTop(scrollEl.scrollTop);
    };

    sync();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(scrollEl);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scrollEl.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [scrollEl]);

  // Row heights, then running offsets. A few hundred additions per scroll
  // frame is nothing, and recomputing keeps this honest when heights change.
  const heights = items.map(
    (item) => measured.get(getKey(item)) ?? Math.max(1, estimate(item, viewport.width))
  );
  const offsets: number[] = new Array(items.length);
  let running = 0;
  for (let i = 0; i < items.length; i++) {
    offsets[i] = running;
    running += heights[i];
  }
  const totalHeight = running;

  // The window: everything intersecting the viewport, plus overscan.
  const viewHeight = viewport.height || 800;
  let first = 0;
  while (first < items.length - 1 && offsets[first + 1] <= scrollTop) first++;
  let last = first;
  while (last < items.length - 1 && offsets[last] + heights[last] < scrollTop + viewHeight) last++;
  const start = Math.max(0, first - overscan);
  const end = Math.min(items.length - 1, last + overscan);

  const visible: { item: T; index: number; key: string }[] = [];
  for (let i = start; i <= end && items.length > 0; i++) {
    visible.push({ item: items[i], index: i, key: getKey(items[i]) });
  }

  // Measure whatever is mounted. Re-running only when the mounted set changes
  // keeps this off the scroll path; the ResizeObserver catches rows that grow
  // afterwards (a comment preview arriving, an image finally decoding).
  const mountedKeys = visible.map((v) => v.key).join("|");
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const read = () => {
      const rows = Array.from(container.children) as HTMLElement[];
      // Functional update: this closure outlives several measurements, so it
      // must never build on a stale copy of the map.
      setMeasured((prev) => {
        let next = prev;
        for (const row of rows) {
          const key = row.dataset.vkey;
          if (!key) continue;
          const height = row.offsetHeight;
          if (height > 0 && prev.get(key) !== height) {
            if (next === prev) next = new Map(prev);
            next.set(key, height);
          }
        }
        return next; // same reference when nothing moved — no re-render
      });
    };

    read();
    const ro = new ResizeObserver(read);
    for (const row of Array.from(container.children)) ro.observe(row);
    return () => ro.disconnect();
  }, [mountedKeys, containerRef]);

  // Keep the topmost visible row pinned. When a measurement lands, every row
  // below it shifts; if the row that moved sits above the viewport, the page
  // would appear to jump. Compare where the anchor row was last commit to
  // where it is now, and absorb the difference into scrollTop.
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollEl;
    const previous = anchor.current;
    if (el && previous && el.scrollTop > 0) {
      const index = items.findIndex((item) => getKey(item) === previous.key);
      if (index >= 0) {
        const delta = offsets[index] - previous.offset;
        // Sub-pixel noise isn't worth a scroll write.
        if (Math.abs(delta) >= 1) el.scrollTo({ top: el.scrollTop + delta });
      }
    }
    anchor.current = items.length ? { key: getKey(items[first]), offset: offsets[first] } : null;
  });

  return { visible, totalHeight, offsetTop: offsets[start] ?? 0 };
}
