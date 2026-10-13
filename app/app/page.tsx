import type { Metadata } from "next";
import Link from "next/link";
import InstallCta from "./InstallCta";
import { config } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { siteName } = config();
  const title = `${siteName} now has an app!`;
  const description = `${title} Full-screen feed, push notifications when friends post, and automatic updates — no app store needed.`;
  return {
    title: `Get the ${siteName} App`,
    description,
    openGraph: { title, description, url: "/app", siteName, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const stats = [
  { label: "RATING", value: "5.0", caption: "★★★★★" },
  { label: "AGE", value: "18+", caption: "Adults Only" },
  { label: "ACCESS", value: "Members", caption: "Invite only" },
  { label: "PRICE", value: "Free", caption: "Forever" },
];

const features = [
  {
    title: "Push notifications",
    body: "Know the second someone posts, comments, or likes. The browser version can't do this.",
    icon: (
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    ),
  },
  {
    title: "True full-screen",
    body: "No address bar, no tabs, no browser chrome. Just the feed, edge to edge.",
    icon: (
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    ),
  },
  {
    title: "Updates itself",
    body: "New features just show up. No app store, no update button, no version 2.0.1 changelog.",
    icon: (
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    ),
  },
  {
    title: "Lives on your Home Screen",
    body: "One tap, same as any other app. Real icon and everything.",
    icon: (
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5ZM9 21v-8h6v8" />
    ),
  },
];

const info = [
  ["Category", "Social"],
  ["Compatibility", "iPhone & Android"],
  ["Size", "Basically nothing"],
  ["In-App Purchases", "Never"],
  ["Languages", "English"],
];

function Bar({ w, dim }: { w: string; dim?: boolean }) {
  return <div className={`h-1 rounded-full ${dim ? "bg-field" : "bg-edge"}`} style={{ width: w }} />;
}

const mockHeart = (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="#ff3b5c">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

// Fake phone screens for the "screenshots" strip — pure CSS, no images.
function PhoneFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-52 shrink-0 snap-center">
      <div className="aspect-[9/19] overflow-hidden rounded-[1.75rem] border-[0.5px] border-edge bg-canvas">
        {children}
      </div>
      <p className="mt-2.5 text-center text-[10px] font-semibold uppercase tracking-[1.5px] text-mut">
        {label}
      </p>
    </div>
  );
}

export default function AppStorePage() {
  const { siteName } = config();
  return (
    <main className="mx-auto max-w-xl pb-14">
      {/* header — icon, name, GET */}
      <header className="flex items-center gap-4 px-5 pt-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon-192.png"
          alt={`${siteName} app icon`}
          className="h-24 w-24 shrink-0 rounded-[22px] border-[0.5px] border-edge"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">{siteName}</h1>
          <p className="mt-0.5 text-sm text-meta">A private photo feed</p>
          <div className="mt-3 flex items-center gap-3">
            <InstallCta variant="pill" />
            <span className="text-[10px] leading-tight text-mut">
              Free · No app store
              <br />
              needed
            </span>
          </div>
        </div>
      </header>

      {/* app-store stats strip */}
      <div className="mt-8 flex divide-x-[0.5px] divide-line border-y-[0.5px] border-line py-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-1 flex-col items-center gap-1 px-1">
            <span className="text-[9px] font-bold tracking-[1px] text-mut">{s.label}</span>
            <span className="text-lg font-extrabold text-body">{s.value}</span>
            <span className="text-[9px] text-mut">{s.caption}</span>
          </div>
        ))}
      </div>

      {/* "screenshots" */}
      <div className="relative mt-8">
        {/* right-edge fade hints there's more to scroll */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-canvas to-transparent"
        />
        <div className="flex touch-pan-x touch-pan-y snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-5 pb-2 [scrollbar-width:none]">
          <PhoneFrame label="The feed">
            <div className="flex h-8 items-center justify-center border-b-[0.5px] border-line">
              <span className="text-[10px] font-extrabold tracking-[2px]">{siteName}</span>
            </div>
            <div
              aria-hidden
              className="aspect-square w-full bg-[radial-gradient(circle_at_65%_30%,#737373_0%,#262626_38%,#0a0a0a_78%)]"
            />
            <div className="flex items-center justify-between px-2.5 pt-2">
              <div className="flex items-center gap-1.5">
                <div aria-hidden className="h-5 w-5 rounded-full bg-neutral-600" />
                <span className="text-[9px] font-bold">Alex</span>
              </div>
              <span className="text-[7px] font-medium text-meta">JUL 11, 7:44 PM</span>
            </div>
            <p className="px-2.5 pt-0.5 text-[8px] leading-snug text-body">sea of people</p>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              {mockHeart}
              <span className="text-[8px] font-bold text-mut">4</span>
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#555" strokeWidth={2}>
                <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5Z" />
              </svg>
              <span className="text-[8px] font-bold text-mut">1</span>
            </div>
  
            <div className="mt-1 border-t-[0.5px] border-line" />
            <div
              aria-hidden
              className="aspect-square w-full bg-[linear-gradient(145deg,#525252_0%,#171717_50%,#404040_100%)]"
            />
            <div className="flex items-center justify-between px-2.5 pt-2">
              <div className="flex items-center gap-1.5">
                <div aria-hidden className="h-5 w-5 rounded-full bg-neutral-600" />
                <span className="text-[9px] font-bold">Alex</span>
              </div>
              <span className="text-[7px] font-medium text-meta">JUL 12, 9:15 PM</span>
            </div>
            <p className="px-2.5 pt-0.5 text-[8px] leading-snug text-body">quick trip to nyc</p>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              {mockHeart}
              <span className="text-[8px] font-bold text-mut">7</span>
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#555" strokeWidth={2}>
                <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5Z" />
              </svg>
              <span className="text-[8px] font-bold text-mut">2</span>
            </div>
          </PhoneFrame>
  
          <PhoneFrame label="The moment they post">
            <div className="flex h-full flex-col items-center bg-gradient-to-b from-neutral-900 to-canvas pt-8">
              <span className="text-3xl font-extrabold tracking-tight">8:41</span>
              <span className="mt-1 text-[9px] text-meta">Sunday, July 26</span>
              <div className="mt-8 w-[86%] rounded-xl border-[0.5px] border-edge bg-card/90 p-2.5">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold leading-tight">{siteName}</p>
                    <p className="text-[9px] leading-tight text-body">Alex posted a photo</p>
                  </div>
                  <span className="self-start text-[8px] text-mut">now</span>
                </div>
              </div>
              <div className="mt-2 w-[86%] rounded-xl border-[0.5px] border-edge bg-card/60 p-2.5">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Bar w="60%" />
                    <Bar w="40%" dim />
                  </div>
                </div>
              </div>
            </div>
          </PhoneFrame>
  
          <PhoneFrame label="Your profile">
            <div className="flex h-8 items-center justify-center border-b-[0.5px] border-line">
              <span className="text-[10px] font-extrabold tracking-[2px]">{siteName}</span>
            </div>
            <div className="flex flex-col items-center border-b-[0.5px] border-line pb-3 pt-4">
              <div
                aria-hidden
                className="h-14 w-14 rounded-full border-2 border-edge bg-neutral-600"
              />
              <div className="mt-2 flex flex-col items-center gap-1">
                <span className="text-[11px] font-extrabold tracking-tight">Alex</span>
                <span className="text-[7px] text-mut">JOINED DECEMBER 2024</span>
                <span className="text-[7px] font-semibold tracking-[0.5px] text-mut">3 POSTS</span>
              </div>
            </div>
            <div
              aria-hidden
              className="mt-1 aspect-square w-full bg-[linear-gradient(35deg,#171717_0%,#525252_48%,#0a0a0a_100%)]"
            />
            <div className="flex items-center justify-between px-2.5 pt-2">
              <div className="flex items-center gap-1.5">
                <div aria-hidden className="h-5 w-5 rounded-full bg-neutral-600" />
                <span className="text-[9px] font-bold">Alex</span>
              </div>
              <span className="text-[7px] font-medium text-meta">JUL 8, 2:37 PM</span>
            </div>
            <p className="px-2.5 pt-0.5 text-[8px] leading-snug text-body">Cult · Lodi 2021 Cab Sauv</p>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              {mockHeart}
              <span className="text-[8px] font-bold text-mut">5</span>
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#555" strokeWidth={2}>
                <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5Z" />
              </svg>
              <span className="text-[8px] font-bold text-mut">2</span>
            </div>
          </PhoneFrame>
        </div>
      </div>

      {/* description */}
      <section className="mt-9 px-5">
        <h2 className="text-[11px] font-bold uppercase tracking-[1.5px] text-mut">
          About this app
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-body">
          {siteName} is a members-only photo feed. No algorithm, no ads, and no
          suggested posts—just photos from the people in the community.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-body">
          The app is the full experience: it lives on your Home Screen like any other app, opens
          full-screen with zero browser chrome, and pings you the moment a friend posts. And since
          it&rsquo;s a web app under the hood, it updates itself — you&rsquo;ll never touch an app
          store.
        </p>
      </section>

      {/* features */}
      <section className="mt-9 px-5">
        <h2 className="text-[11px] font-bold uppercase tracking-[1.5px] text-mut">
          Why the app hits different
        </h2>
        <div className="mt-4 flex flex-col gap-2.5">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex items-start gap-3.5 rounded-xl border-[0.5px] border-line bg-card p-4"
            >
              <svg
                viewBox="0 0 24 24"
                className="mt-0.5 h-5 w-5 shrink-0 text-body"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {f.icon}
              </svg>
              <div>
                <p className="text-sm font-bold">{f.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-meta">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* what's new */}
      <section className="mt-9 px-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-[1.5px] text-mut">
            What&rsquo;s new
          </h2>
          <span className="text-[10px] text-mut">arrived automatically, obviously</span>
        </div>
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px] leading-relaxed text-body">
          <li>· Announcements &amp; broadcasts from HQ</li>
          <li>· Pull-to-refresh on the feed</li>
          <li>· Notification controls on your profile</li>
        </ul>
      </section>

      {/* big install button */}
      <div className="mt-10 px-5">
        <InstallCta variant="full" />
        <p className="mt-2.5 text-center text-[11px] text-mut">
          Takes about 10 seconds. Your phone already has everything it needs.
        </p>
      </div>

      {/* information */}
      <section className="mt-10 px-5">
        <h2 className="text-[11px] font-bold uppercase tracking-[1.5px] text-mut">Information</h2>
        <dl className="mt-2">
          {info.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between border-b-[0.5px] border-line py-3 text-[13px]"
            >
              <dt className="text-mut">{label}</dt>
              <dd className="font-medium text-body">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-8 text-center text-[12px] text-mut">
        Not ready to install?{" "}
        <Link href="/" className="font-semibold text-body underline underline-offset-2">
          Just open {siteName} in your browser
        </Link>
      </p>

      <footer className="mt-12 flex justify-center">
        <p className="text-[10px] tracking-[0.5px] text-dim">powered by NoPostNow</p>
      </footer>
    </main>
  );
}
