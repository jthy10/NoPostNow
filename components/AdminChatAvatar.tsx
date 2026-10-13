import { site } from "@/lib/site";

// The admins chat's face. Deliberately not an Avatar — it is a channel, not a
// person, so it reads as a wordmark tile built from the site's own name.
export default function AdminChatAvatar({ className }: { className: string }) {
  const words = site().siteName.trim().split(/\s+/).filter(Boolean);
  const mark = (
    words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 2)
  ).toUpperCase();
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-white font-extrabold tracking-[-0.5px] text-black ${className}`}
      aria-hidden
    >
      {mark}
    </div>
  );
}
