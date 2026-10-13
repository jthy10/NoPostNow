"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { MASCOT_DETAILS, type MascotKind } from "@/lib/mascot";

// Air to leave between the mascot and the nav buttons it turns around at.
const STOP_GAP = 2;
const MIN_TRIP = 16;

// A trip is stitched out of fixed beats plus one walk whose length depends on
// the bar: the dissolve, the gather and the about-face take the same time on a
// phone as on a desktop, and only the walking stretches. The old single
// keyframe track gave every beat a percentage of the total, so a wide screen
// made the animal stand at the wall for most of a second.
const FADE_MS = 160; // idle pose dissolving into the travel pose
const WINDUP_MS = 190; // gather before the first step — covers the dissolve
const TURN_MS = 380; // one about-face

// Only an animal that rests in profile has to turn back once it is home: a cat
// and a dog sit facing the reader, and a crab has no front at all. For them a
// second about-face is a beat spent standing on the spot with the legs still
// going — they get home and sit. The duck stands side-on, so it does turn, but
// it starts the pivot before it stops so the two read as one move.
const TURNS_HOME: Record<MascotKind, boolean> = {
  cat: false,
  duck: true,
  crab: false,
  dog: false,
};
const HOME_TURN_LEAD = 0.6; // how much of that turn happens while still moving

// Ground speed in px/s, and how far one full leg cycle carries the animal.
// Driving the step rate off the real speed is what stops the feet skating:
// a wider bar buys a longer walk, not a faster-looking one.
const GAIT: Record<MascotKind, { speed: number; stride: number }> = {
  cat: { speed: 84, stride: 42 },
  duck: { speed: 66, stride: 27 },
  crab: { speed: 80, stride: 24 },
  dog: { speed: 118, stride: 36 },
};

// Reduce Motion rules out the walk across the bar, but a tap still has to be
// answered — otherwise the animal is a button that does nothing. Instead the
// animal rises into its travel pose, holds, and settles back: a still change
// of stance, no travel and no looping.
const POSE_MS = 1000;

// A backgrounded PWA can stall the trip partway. Every beat has a known
// length, so the timer that ends a trip is exact rather than a guess, but
// keep a little slack so it never cuts the settle short.
const TRIP_SLACK_MS = 120;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

type Trip = { totalMs: number; style: CSSProperties };

// Hand the whole schedule to CSS as custom properties. Each beat is its own
// animation with its own delay, so the turns stay crisp at any width.
function planTrip(dist: number, animal: MascotKind): Trip {
  const { speed, stride } = GAIT[animal];
  // A full-width desktop bar is a long way to walk, so cap the leg: past a
  // few hundred pixels the animal covers the ground faster rather than
  // keeping the same pace for eight seconds.
  const walkMs = clamp((dist / speed) * 1000, 420, 2600);
  const actual = dist / (walkMs / 1000);
  // Going faster lengthens the stride as well as quickening the step, so the
  // cadence rises with the root of the speed instead of tracking it. Matching
  // the step to the real ground speed is what stops the feet skating.
  const stepMs = clamp(
    ((stride / actual) * 1000 * Math.sqrt(actual / speed)),
    150,
    900
  );

  const turnOutAt = WINDUP_MS + walkMs;
  const walkBackAt = turnOutAt + TURN_MS;
  const homeAt = walkBackAt + walkMs;
  // Sitting down begins the moment the animal runs out of moving to do. Any
  // gap here is a beat of standing still with the legs going, which reads as
  // the animation having forgotten to end.
  const turnHomeAt = homeAt - TURN_MS * HOME_TURN_LEAD;
  const settleAt = TURNS_HOME[animal]
    ? turnHomeAt + TURN_MS
    : homeAt;
  const totalMs = settleAt + FADE_MS;
  const ms = (value: number) => `${Math.round(value)}ms`;

  return {
    totalMs,
    style: {
      "--m-out": `${dist}px`,
      "--m-back": `${-dist}px`,
      "--m-walk": ms(walkMs),
      "--m-step": ms(stepMs),
      "--m-turn": ms(TURN_MS),
      "--m-fade": ms(FADE_MS),
      "--m-walk-at": ms(WINDUP_MS),
      "--m-turn-out-at": ms(turnOutAt),
      "--m-walk-back-at": ms(walkBackAt),
      "--m-turn-home-at": ms(turnHomeAt),
      "--m-settle-at": ms(settleAt),
    } as CSSProperties,
  };
}

type MascotProps = {
  animal: MascotKind;
  className?: string;
  stopBeforeRef?: RefObject<HTMLElement | null>;
  rowRef?: RefObject<HTMLElement | null>;
};

export default function Mascot({
  animal,
  className = "",
  stopBeforeRef,
  rowRef,
}: MascotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [posing, setPosing] = useState(false);

  // Both endings run on one timer: the reduced-motion hold, and the end of a
  // trip once every beat has played out.
  const releaseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearRelease() {
    if (releaseRef.current) clearTimeout(releaseRef.current);
    releaseRef.current = null;
  }
  useEffect(() => clearRelease, []);

  function startTrip() {
    if (trip || posing || !svgRef.current) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPosing(true);
      releaseRef.current = setTimeout(() => {
        releaseRef.current = null;
        setPosing(false);
      }, POSE_MS);
      return;
    }

    const bounds = svgRef.current.getBoundingClientRect();
    const limit =
      stopBeforeRef?.current?.getBoundingClientRect().left ??
      rowRef?.current?.getBoundingClientRect().right;
    if (limit === undefined) return;

    const dist = Math.round(limit - bounds.right - STOP_GAP);
    if (dist < MIN_TRIP) return;

    const planned = planTrip(dist, animal);
    setTrip(planned);
    releaseRef.current = setTimeout(() => {
      releaseRef.current = null;
      setTrip(null);
    }, planned.totalMs + TRIP_SLACK_MS);
  }

  const action = MASCOT_DETAILS[animal].action;

  return (
    <button
      type="button"
      onClick={startTrip}
      aria-label={`Make the ${animal} ${action}`}
      className="-m-1.5 shrink-0 p-1.5 leading-none"
      style={trip?.style}
    >
      {/* Two nested tracks carry the walk out and the walk home. Splitting
          them is what lets each leg keep its own duration and easing instead
          of sharing one percentage-based timeline. */}
      <span className={`mascot-track ${trip ? "mascot-go" : ""}`}>
        <span className="mascot-track-back">
          <svg
            ref={svgRef}
            viewBox="0 0 27 24"
            aria-hidden="true"
            fill="currentColor"
            className={`h-[30px] w-[34px] ${className}`}
          >
            {trip ? (
              <TripPose animal={animal} />
            ) : posing ? (
              <TravelingPose animal={animal} />
            ) : (
              <IdlePose animal={animal} />
            )}
          </svg>
        </span>
      </span>
    </button>
  );
}

export function MascotPreview({ animal }: { animal: MascotKind }) {
  return (
    <svg
      viewBox="0 0 27 24"
      aria-hidden="true"
      fill="currentColor"
      className="h-10 w-12"
    >
      <IdlePose animal={animal} />
    </svg>
  );
}

// Both poses are on screen for the whole trip and cross-dissolve at each end,
// so a change of stance reads as the animal gathering itself rather than as a
// sprite swap. Only the travelling one goes inside the about-faces: keeping
// the resting pose out of them means it is never mirrored, and an animal that
// walks home backwards can dissolve straight into it without turning first.
function TripPose({ animal }: { animal: MascotKind }) {
  const travelling = (
    <g className="mascot-pose-travel">
      <TravelingPose animal={animal} />
    </g>
  );

  return (
    <>
      <g className={`mascot-turn-a mascot-turn-${animal}`}>
        {TURNS_HOME[animal] ? (
          <g className={`mascot-turn-b mascot-turn-${animal}`}>{travelling}</g>
        ) : (
          travelling
        )}
      </g>
      <g className="mascot-pose-idle">
        <IdlePose animal={animal} />
      </g>
    </>
  );
}

function IdlePose({ animal }: { animal: MascotKind }) {
  switch (animal) {
    case "duck":
      return <DuckStanding />;
    case "crab":
      return <CrabResting />;
    case "dog":
      return <DogSitting />;
    default:
      return <CatSitting />;
  }
}

function TravelingPose({ animal }: { animal: MascotKind }) {
  switch (animal) {
    case "duck":
      return <DuckWaddling />;
    case "crab":
      return <CrabScuttling />;
    case "dog":
      return <DogRunning />;
    default:
      return <CatWalking />;
  }
}

/* Every animal stands on the same ground line at y=21.6. None of them is
   centred in the view box — a duck is mostly bill — so each turns about its
   own middle, set as --m-pivot in the stylesheet. Corners are rounded with a hairline stroke of the fill
   colour rather than left sharp: at 30px a bare triangle reads as a spike.
   Feet stop half a stroke width short of the ground line so the round cap
   lands on it rather than through it. */

function CatSitting() {
  return (
    <>
      <path
        className="cat-tail"
        d="M16.6 20.2c4.1.8 5.8-1.9 4.1-4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <g className="cat-body">
        <path
          d="M9.2 6.7 8.6 3.4 11.4 5Z"
          stroke="currentColor"
          strokeWidth={0.85}
          strokeLinejoin="round"
        />
        <path
          className="cat-ear-r"
          d="M15.8 6.7 16.4 3.4 13.6 5Z"
          stroke="currentColor"
          strokeWidth={0.85}
          strokeLinejoin="round"
        />
        <path d="M12.5 12.1c-3.8 0-6.6 3.7-6.6 7.1 0 1.6 1 2.4 2.6 2.4h8c1.6 0 2.6-.8 2.6-2.4 0-3.4-2.8-7.1-6.6-7.1Z" />
        <circle cx="12.5" cy="8.9" r="4.7" />
        {/* A slit between the front paws — a seated cat with a plain hem
            reads as a bowling pin. */}
        <rect className="fill-canvas" x="12.02" y="19.4" width="1" height="2.2" rx=".5" />
        <ellipse className="cat-eye-l fill-canvas" cx="10.5" cy="8.8" rx="1.05" ry="1.2" />
        <ellipse className="cat-eye-r fill-canvas" cx="14.5" cy="8.8" rx="1.05" ry="1.2" />
        <path className="fill-canvas" d="M11.5 10.9h2l-1 1.35Z" />
      </g>
    </>
  );
}

function CatWalking() {
  return (
    <g className="cat-w-body">
      <path
        className="cat-w-tail"
        d="M6.5 12.8C3.6 11.6 3 8.7 4.7 6.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path className="cat-w-leg-1 mascot-far" strokeWidth={1.4} d="M9 17.1 8.2 19l.75 1.9h1.1" />
        <path className="cat-w-leg-3 mascot-far" strokeWidth={1.4} d="M15 17.1l-.3 1.9.75 1.9h1.1" />
        <path className="cat-w-leg-2" strokeWidth={1.8} d="M11.2 17.4l-.8 1.9.8 1.4h1.2" />
        <path className="cat-w-leg-4" strokeWidth={1.8} d="M17.1 17.1l-.3 2 .6 1.6h1.2" />
      </g>
      {/* Rump, barrel and chest as three overlapping shapes — a single
          ellipse reads as a bean with a head stuck on it. */}
      <circle cx="8.7" cy="14.5" r="3.9" />
      <ellipse cx="12.6" cy="14.4" rx="5.4" ry="3.5" />
      <circle cx="16.4" cy="14.1" r="3.7" />
      <path
        d="M22 7.4 22.8 5.3 23.6 7.6Z"
        stroke="currentColor"
        strokeWidth={0.75}
        strokeLinejoin="round"
      />
      <path
        className="cat-w-ear"
        d="M18.9 7.9 18.7 5 21.2 6.7Z"
        stroke="currentColor"
        strokeWidth={0.75}
        strokeLinejoin="round"
      />
      <circle cx="20.3" cy="10.3" r="3.6" />
      <path d="M22.6 10.7c1.6-.15 2.5.45 2.5 1.15 0 .7-.9 1.2-2.5 1.05Z" />
      <circle className="fill-canvas" cx="21.6" cy="10" r=".95" />
    </g>
  );
}

function DuckStanding() {
  return (
    <g className="duck-idle-body">
      <path
        d="M7.7 12.9 4 11.5 7.3 15.3Z"
        stroke="currentColor"
        strokeWidth={0.85}
        strokeLinejoin="round"
      />
      <g>
        <path
          d="M9.2 19.9 12.1 21.6H8Z"
          stroke="currentColor"
          strokeWidth={0.7}
          strokeLinejoin="round"
        />
        <path
          d="M14.4 19.9 17.3 21.6h-4.1Z"
          stroke="currentColor"
          strokeWidth={0.7}
          strokeLinejoin="round"
        />
        <path
          d="M9.2 18.3v1.8m5.2-1.8v1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.35}
          strokeLinecap="round"
        />
      </g>
      <ellipse cx="11.6" cy="15.3" rx="6.5" ry="4.1" />
      <path d="M15.6 13.2c-.4-2.8.1-5.8 2.2-6.3 1.9-.5 3.3 1.6 2.5 4l-1.7 4.6Z" />
      <circle cx="19.4" cy="8.5" r="3.5" />
      {/* A flat rounded bill. The old spear read as a bird of prey. */}
      <path d="M21.1 7.9c1.7-.8 4.1-1 5-.3.9.65.3 2.05-1 2.6-1.35.55-3.05.65-3.95.25Z" />
      <circle className="duck-eye fill-canvas" cx="20" cy="7.8" r=".9" />
      {/* The folded wing as a thin crescent. A fat oval cutout turned the
          body into a doughnut. */}
      <path
        className="duck-idle-wing fill-canvas"
        d="M13.9 14Q10.5 13.7 8 16.4Q11.1 15.1 13.9 14Z"
      />
    </g>
  );
}

function DuckWaddling() {
  return (
    <g className="duck-w-body">
      <g className="duck-leg-l">
        <path
          d="M9.2 19.9 12.1 21.6H8Z"
          stroke="currentColor"
          strokeWidth={0.7}
          strokeLinejoin="round"
        />
        <path
          d="M9.2 18.3v1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.35}
          strokeLinecap="round"
        />
      </g>
      <g className="duck-leg-r">
        <path
          d="M14.4 19.9 17.3 21.6h-4.1Z"
          stroke="currentColor"
          strokeWidth={0.7}
          strokeLinejoin="round"
        />
        <path
          d="M14.4 18.3v1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.35}
          strokeLinecap="round"
        />
      </g>
      <path
        className="duck-w-tail"
        d="M7.7 12.9 4 11.5 7.3 15.3Z"
        stroke="currentColor"
        strokeWidth={0.85}
        strokeLinejoin="round"
      />
      <ellipse cx="11.6" cy="15.3" rx="6.5" ry="4.1" />
      <path d="M15.6 13.2c-.4-2.8.1-5.8 2.2-6.3 1.9-.5 3.3 1.6 2.5 4l-1.7 4.6Z" />
      <circle cx="19.4" cy="8.5" r="3.5" />
      <path d="M21.1 7.9c1.7-.8 4.1-1 5-.3.9.65.3 2.05-1 2.6-1.35.55-3.05.65-3.95.25Z" />
      <circle className="fill-canvas" cx="20" cy="7.8" r=".9" />
      <path
        className="duck-wing fill-canvas"
        d="M13.9 14Q10.5 13.7 8 16.4Q11.1 15.1 13.9 14Z"
      />
    </g>
  );
}

// Six legs and two pincers, all mirrored about x=13.5. Each claw is a stubby
// pair of fingers around a wrist, so it can open and close and — more to the
// point — so it reads as a pincer. The old arrowheads made a spider.
function CrabParts() {
  return (
    <>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path className="crab-leg-1" d="M6.9 13.9 3.6 15.4 2.3 19.2" />
        <path className="crab-leg-2" d="M5.6 16.4 2.9 18.5 3.2 21" />
        <path className="crab-leg-3" d="M6.8 18.6 5.4 20.3 7.1 21" />
        <path className="crab-leg-4" d="M20.1 13.9 23.4 15.4 24.7 19.2" />
        <path className="crab-leg-5" d="M21.4 16.4 24.1 18.5 23.8 21" />
        <path className="crab-leg-6" d="M20.2 18.6 21.6 20.3 19.9 21" />
      </g>

      <g
        className="crab-claw-l"
        stroke="currentColor"
        strokeWidth={0.5}
        strokeLinejoin="round"
      >
        <path
          d="M8.2 11.8 5.6 9.9"
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <circle cx="5" cy="9.4" r="1.6" />
        <path
          className="crab-claw-l-top"
          d="M5.3 8.6C4.2 8.3 3 7.7 2.3 7 1.7 6.4 2.3 5.6 3.2 6c1.2.5 2.3 1.5 2.8 2.4Z"
        />
        <path
          className="crab-claw-l-bottom"
          d="M5.5 10.3c-1.3.8-2.9 1.2-3.8.9-.9-.3-.8-1.4.2-1.7 1.2-.4 2.8-.1 3.8.5Z"
        />
      </g>
      <g
        className="crab-claw-r"
        stroke="currentColor"
        strokeWidth={0.5}
        strokeLinejoin="round"
      >
        <path
          d="M18.8 11.8 21.4 9.9"
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <circle cx="22" cy="9.4" r="1.6" />
        <path
          className="crab-claw-r-top"
          d="M21.7 8.6c1.1-.3 2.3-.9 3-1.6.6-.6 0-1.4-.9-1-1.2.5-2.3 1.5-2.8 2.4Z"
        />
        <path
          className="crab-claw-r-bottom"
          d="M21.5 10.3c1.3.8 2.9 1.2 3.8.9.9-.3.8-1.4-.2-1.7-1.2-.4-2.8-.1-3.8.5Z"
        />
      </g>

      <path
        d="M11.3 10.7V8.1m4.4 2.6V8.1"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <path d="M13.5 10.4c-5.3 0-9.2 1.8-9.2 4.1 0 2.9 3.7 5.1 9.2 5.1s9.2-2.2 9.2-5.1c0-2.3-3.9-4.1-9.2-4.1Z" />
      <circle cx="11.3" cy="7.1" r="1.6" />
      <circle cx="15.7" cy="7.1" r="1.6" />
      <circle className="crab-eye-l fill-canvas" cx="11.3" cy="7.05" r=".68" />
      <circle className="crab-eye-r fill-canvas" cx="15.7" cy="7.05" r=".68" />
      <path
        className="fill-canvas"
        d="M11.1 15.4c1.4 1.3 3.9 1.3 5.3 0-.5 2-4.8 2-5.3 0Z"
      />
    </>
  );
}

// A crab is the widest animal here, and its claw would otherwise sit right up
// against the T of the wordmark — the nav leans on each mascot's own view-box
// margin for that air. Held on an inner group so the CSS transform that bobs
// the body still composes with it. Scaled about the ground line, so the feet
// stay on it.
const CRAB_FIT = "translate(2.62 2.592) scale(.88)";

function CrabResting() {
  return (
    <g className="crab-idle-body">
      <g transform={CRAB_FIT}>
        <CrabParts />
      </g>
    </g>
  );
}

function CrabScuttling() {
  return (
    <g className="crab-w-body">
      <g transform={CRAB_FIT}>
        <CrabParts />
      </g>
    </g>
  );
}

function DogSitting() {
  return (
    <>
      <path
        className="dog-idle-tail"
        d="M17.4 18.3c3.1-.3 3.9-2.7 2.6-4.7"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <g className="dog-idle-body">
        {/* Ears hang past the jaw on both sides. Pointed ears were the whole
            reason this read as a second cat. */}
        <path
          className="dog-idle-ear-l"
          d="M9.4 5.5c-2.7.5-3.7 2.8-3.1 5.6.5 2.6 2 3.9 3.4 3.5 1.2-2.7 1.3-6.4-.3-9.1Z"
        />
        <path
          className="dog-idle-ear-r"
          d="M15.4 5.5c2.7.5 3.7 2.8 3.1 5.6-.5 2.6-2 3.9-3.4 3.5-1.2-2.7-1.3-6.4.3-9.1Z"
        />
        <path d="M12.4 12.6c-3.8 0-6.6 3.4-6.6 6.8 0 1.5 1 2.2 2.6 2.2h8c1.6 0 2.6-.7 2.6-2.2 0-3.4-2.8-6.8-6.6-6.8Z" />
        <circle cx="12.4" cy="9.3" r="4.6" />
        <ellipse cx="12.4" cy="11.7" rx="2.7" ry="2" />
        <rect className="fill-canvas" x="11.93" y="19.4" width=".94" height="2.2" rx=".47" />
        <circle className="dog-eye-l fill-canvas" cx="10.4" cy="8.8" r=".95" />
        <circle className="dog-eye-r fill-canvas" cx="14.4" cy="8.8" r=".95" />
        <ellipse className="fill-canvas" cx="12.4" cy="10.9" rx="1.3" ry=".95" />
        <path className="fill-canvas" d="M12.05 11.7h.7v1.5h-.7Z" />
      </g>
    </>
  );
}

function DogRunning() {
  return (
    <g className="dog-run-body">
      <path
        className="dog-run-tail"
        d="M6.1 12.5C3.3 11.7 2.5 8.9 4.1 6.9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path className="dog-run-leg-1 mascot-far" strokeWidth={1.5} d="M8.8 16.4 7.9 18.5l.85 2.35h1.1" />
        <path className="dog-run-leg-2" strokeWidth={1.85} d="M10.9 16.7 10.1 18.7l.8 2h1.2" />
        <path className="dog-run-leg-3 mascot-far" strokeWidth={1.5} d="M15.2 16.4l.4 2.1.75 2.35h1.1" />
        <path className="dog-run-leg-4" strokeWidth={1.85} d="M17.2 16.2l.5 2.2.8 2.3h1.2" />
      </g>
      <circle cx="8.5" cy="14.1" r="3.9" />
      <ellipse cx="12.4" cy="14" rx="5.5" ry="3.5" />
      <circle cx="16.2" cy="13.8" r="3.7" />
      {/* One ear, streaming back. Upright ears at this size made a rabbit. */}
      <path
        className="dog-run-ear"
        d="M18.9 9.3c-2.3.35-4.15-.35-4.6-1.5-.25-.7.35-1.25 1.15-1.05 1.65.4 3 1.35 3.45 2.55Z"
      />
      <circle cx="19.8" cy="10" r="3.55" />
      <path d="M22.2 9.2c1.9-.35 3.6.3 3.6 1.25 0 .95-1.4 1.5-3.1 1.3l-1.4-.15Z" />
      <circle className="fill-canvas" cx="21" cy="9.6" r=".95" />
      <circle className="fill-canvas" cx="24.8" cy="10.3" r=".55" />
    </g>
  );
}
