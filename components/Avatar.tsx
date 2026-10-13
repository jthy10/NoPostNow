"use client";

import { useAvatarPath } from "@/lib/users";
import { useAuthedImage } from "@/lib/use-authed-image";

export function initials(username: string) {
  if (!username || username === "Anonymous") return "?";
  const parts = username.trim().split(/[\s_\-.]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

// Size/text classes come from the caller, e.g. "h-7 w-7 text-[10px]".
export default function Avatar({
  username,
  className,
}: {
  username: string;
  className: string;
}) {
  const src = useAuthedImage(useAvatarPath(username));

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border-[1.5px] border-edge bg-[#222] font-bold uppercase text-[#888] ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(username)
      )}
    </div>
  );
}
