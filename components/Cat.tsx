"use client";

import { useRef, useState, type CSSProperties, type RefObject } from "react";

// A little white cat that sits next to the wordmark. Tap it and it walks the
// length of the bar, turns around just before the buttons, walks back and
// sits down again.
//
// Two poses, because a sitting cat sliding sideways reads as being dragged
// rather than walking: the front-facing sitter you normally see, and a side-on
// walker with legs. Both are drawn to the same ground line — feet at y≈21.2 in
// the view box — so swapping between them doesn't make the cat hop.
//
// Inline SVG plus the cat-* keyframes in globals.css: no image request, and no
// JavaScript at all once a walk is underway.

// Air to leave between the cat and the buttons it turns around at. The walking
// pose's ink stops ~5px short of the view box's right edge, so the real gap is
// this plus that.
const STOP_GAP = 2;

// A relaxed walk, not a fixed duration — otherwise the same trip sprints
// across a narrow screen and crawls across a wide one. The fixed time covers
// the turn and the little beat before sitting; distance only controls travel.
const walkSeconds = (dist: number) => Math.round((1.45 + dist / 46) * 100) / 100;

// Below this there's no room worth walking into, so the tap does nothing
// rather than producing a twitch.
const MIN_WALK = 16;

export default function Cat({
  className = "",
  stopBeforeRef,
  rowRef,
}: {
  className?: string;
  // What the cat turns around at — the nav's right-hand buttons. Falls back to
  // the row's own right edge, which is what's there when nobody's signed in.
  stopBeforeRef?: RefObject<HTMLElement | null>;
  rowRef?: RefObject<HTMLElement | null>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [walk, setWalk] = useState<{ dist: number; secs: number } | null>(null);

  function startWalk() {
    if (walk || !svgRef.current) return;
    // A long looping journey across the screen is exactly the kind of motion
    // this setting is asking us not to start.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Measured per tap rather than once, so the cat still turns in the right
    // place after a rotation, a resize, or the bell badge changing width.
    const cat = svgRef.current.getBoundingClientRect();
    const limit =
      stopBeforeRef?.current?.getBoundingClientRect().left ??
      rowRef?.current?.getBoundingClientRect().right;
    if (limit === undefined) return;

    const dist = Math.round(limit - cat.right - STOP_GAP);
    if (dist < MIN_WALK) return;
    setWalk({ dist, secs: walkSeconds(dist) });
  }

  return (
    <button
      type="button"
      onClick={startWalk}
      aria-label="Make the cat walk"
      // The negative margin cancels the padding, so the bigger tap target
      // costs the layout nothing and the cat stays put.
      className="-m-1.5 shrink-0 p-1.5 leading-none"
    >
      <svg
        ref={svgRef}
        viewBox="0 0 27 24"
        // Decorative — the button around it carries the label.
        aria-hidden="true"
        fill="currentColor"
        // Only the svg's own walk animation ends; the legs and tail loop
        // forever and never fire this.
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setWalk(null);
        }}
        style={
          walk
            ? ({
                "--cat-walk": `${walk.dist}px`,
                "--cat-walk-secs": `${walk.secs}s`,
              } as CSSProperties)
            : undefined
        }
        className={`h-[30px] w-[34px] ${walk ? "cat-walking" : ""} ${className}`}
      >
        {walk ? <Walking /> : <Sitting />}
      </svg>
    </button>
  );
}

function Sitting() {
  return (
    <>
      <g className="cat-body">
        <path d="M7.2 7.1 6.9 3 10.2 5.3 Z" />
        <path className="cat-ear-r" d="M14.8 7.1 15.1 3 11.8 5.3 Z" />
        <circle cx="11" cy="9.2" r="4.5" />
        <path d="M11 12.4c-3.1 0-5.3 3.2-5.3 6.6 0 1.5.8 2.2 2.2 2.2h6.2c1.4 0 2.2-.7 2.2-2.2 0-3.4-2.2-6.6-5.3-6.6z" />
        {/* Eyes are holes punched in the silhouette rather than drawn marks,
            so they stay crisp at 30px and read as eyes the moment they blink. */}
        <circle className="cat-eye-l fill-canvas" cx="9.1" cy="9.2" r="1.05" />
        <circle className="cat-eye-r fill-canvas" cx="12.9" cy="9.2" r="1.05" />
      </g>
      {/* Outside cat-body: the tail swings from its own root, and inheriting
          the body's bob would make the pivot drift as it breathes. */}
      <path
        className="cat-tail"
        d="M15.9 20.1c3.4.6 5.7-1.2 4.9-4.3"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </>
  );
}

function Walking() {
  return (
    <g className="cat-w-body">
      <path
        className="cat-w-tail"
        d="M5.9 13.6C3 12.8 1.9 10.2 3.4 8.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      {/* Legs first so the body covers where they meet it. Bent strokes read
          as hocks and paws at this size; four offset steps give the quieter
          one-foot-at-a-time rhythm of a cat walking instead of a fast trot. */}
      <g stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="cat-w-leg-1" strokeWidth={1.45} opacity={0.78} d="M8.2 16.4 7.4 18.5 8.1 20.5" />
        <path className="cat-w-leg-3" strokeWidth={1.45} opacity={0.78} d="M15.1 16.4 14.6 18.6 15.4 20.5" />
        <path className="cat-w-leg-2" strokeWidth={1.75} d="M10.4 16.5 9.8 18.8 10.7 20.7" />
        <path className="cat-w-leg-4" strokeWidth={1.75} d="M17.2 16.3 16.7 18.7 17.6 20.6" />
      </g>
      <ellipse cx="12" cy="14.6" rx="6.4" ry="3.5" />
      <path d="M17.3 7.9 17.2 4.8 19.3 7.2 Z" />
      <path d="M20.2 7.2 21.5 4.5 22.3 8.2 Z" />
      <circle cx="19.6" cy="10.6" r="3.6" />
      <circle className="fill-canvas" cx="20.9" cy="10.4" r="0.95" />
    </g>
  );
}
