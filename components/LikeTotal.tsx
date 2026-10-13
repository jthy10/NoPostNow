"use client";

// Every like a member has ever collected, sitting under their post count. The
// three most-liked members wear the number in metal — gold, silver, bronze —
// with their place tilted up off the end like a sticker. Everyone else gets
// the same muted line as the post count above it, so the podium is the only
// thing that ever catches the eye.
//
// The glow is a text-shadow rather than a background: the profile header is
// nothing but centered hairline-quiet type, and a chip or a pill here would
// read as a button.

const MEDALS: Record<number, { place: string; color: string; glow: string }> = {
  1: { place: "1ST", color: "#ffcf5a", glow: "rgba(255, 190, 84, 0.45)" },
  // Cool and a shade off white on purpose — the username right above is pure
  // white, and a lighter silver just read as ordinary text rather than metal.
  2: { place: "2ND", color: "#aab8c8", glow: "rgba(170, 184, 200, 0.32)" },
  3: { place: "3RD", color: "#d08b52", glow: "rgba(208, 139, 82, 0.38)" },
};

export default function LikeTotal({
  likes,
  place,
}: {
  likes: number;
  // 1-3 for the podium, null for everyone else (and while it's still unknown).
  place: number | null;
}) {
  const medal = place ? MEDALS[place] : undefined;

  return (
    <p
      className={`mt-1.5 text-xs font-semibold tracking-[0.5px] ${medal ? "" : "text-mut"}`}
      style={medal ? { color: medal.color, textShadow: `0 0 14px ${medal.glow}` } : undefined}
    >
      {/* The place is absolutely positioned off this span rather than set in
          the line, so it takes up no width: the header centers "325 LIKES"
          itself, exactly like the post count above it, and the badge hangs
          off the end without dragging the number off centre. */}
      <span className="relative">
        {likes} LIKE{likes === 1 ? "" : "S"}
        {medal && (
          <sup className="absolute left-full top-[-7px] ml-[3px] rotate-[-12deg] text-[9px] font-extrabold leading-none tracking-[0.5px]">
            {medal.place}
          </sup>
        )}
      </span>
    </p>
  );
}
