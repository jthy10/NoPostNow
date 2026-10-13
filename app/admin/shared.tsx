"use client";

import { useId, useState } from "react";
import { useAuthedImage } from "@/lib/use-authed-image";

/* ---------------------------------- types ---------------------------------- */

export type P = {
  id: string;
  userUUID: string | null;
  username: string | null;
  imagePath?: string;
  caption?: string;
  timestamp: Date | null;
  likedBy: string[];
  imageWidth?: number;
  imageHeight?: number;
  deleted?: boolean;
  deletedAt?: Date | null;
  keys: string[];
};

export type C = {
  id: string;
  postId: string;
  userUUID: string | null;
  username: string | null;
  text: string;
  timestamp: Date | null;
};

export type U = {
  email: string;
  username: string;
  avatarPath: string | null;
  uid: string | null;
  joinedAt: Date | null;
  muted: boolean;
};

export type S = { id: string; uid: string | null; endpoint: string; updatedAt: Date | null };

export type LogEntry = {
  id: string;
  action: string;
  detail: string;
  at: Date | null;
};

export type Announcement = {
  text: string;
  link: string;
  active: boolean;
  updatedAt: Date | null;
};

export type Feedback = {
  id: string;
  uid: string | null;
  username: string;
  email: string;
  text: string;
  at: Date | null;
};

// A member's request to be credited as the owner of an Anonymous post.
// Approving reassigns the photo's userUUID/username; declining just drops it.
export type Claim = {
  id: string;
  postId: string;
  uid: string | null;
  username: string;
  email: string;
  at: Date | null;
};

// unique_users/{uid} -> { firstJoined, email }. The doc id is the uid, which
// makes this the only uid -> email map in the database — and the only way to
// recover the uid of a member who has never posted. Admin-readable only.
export type Identity = { uid: string; email: string | null; firstJoined: Date | null };

// blocks/{uid} -> { blocked: [uid, ...] }. The doc id is the blocker; the
// array is everyone they've blocked. Every block check in the app — the
// server-side push fan-out and every filtered list on the client — matches
// on these uids and nothing else.
export type Block = { uid: string; blocked: string[] };

export type Data = {
  photos: P[];
  comments: C[];
  users: U[];
  subs: S[];
  legacy: Date[];
  identities: Identity[];
  blocks: Block[];
  log: LogEntry[];
  announcement: Announcement | null;
  feedback: Feedback[];
  claims: Claim[];
};

/* --------------------------------- helpers --------------------------------- */

export const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
export const fmtDateTime = (d: Date | null) =>
  d
    ? `${fmtDate(d)}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : "—";
export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};
export const daysAgo = (n: number) => Date.now() - n * 86_400_000;
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Every month from the earliest date to now, zero-filled.
export function byMonth(dates: Date[]): { label: string; v: number }[] {
  if (!dates.length) return [];
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(monthKey(d), (counts.get(monthKey(d)) ?? 0) + 1);
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const out: { label: string; v: number }[] = [];
  const cur = new Date(min.getFullYear(), min.getMonth(), 1);
  const now = new Date();
  while (cur <= now) {
    const key = monthKey(cur);
    out.push({ label: monthLabel(key), v: counts.get(key) ?? 0 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

// Longest / current runs of consecutive days in a set of day keys.
export function streaks(days: Set<string>): { longest: number; current: number } {
  if (!days.size) return { longest: 0, current: 0 };
  const stamps = [...days]
    .map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    })
    .sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < stamps.length; i++) {
    run = stamps[i] - stamps[i - 1] === 86_400_000 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  // Current streak must still be alive (today or yesterday).
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const last = stamps[stamps.length - 1];
  let current = 0;
  if (t0 - last <= 86_400_000) {
    current = 1;
    for (let i = stamps.length - 2; i >= 0; i--) {
      if (stamps[i + 1] - stamps[i] === 86_400_000) current++;
      else break;
    }
  }
  return { longest, current };
}

/* ------------------------------- UI primitives ------------------------------ */

/* One button scale across the console: 32px tall, 12px label, three weights —
   ghost (default), primary (the one committing action), danger (destructive). */
export const btn =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border-[0.5px] border-edge bg-white/[0.02] px-3 text-[11px] font-semibold text-body transition-colors hover:border-mut hover:bg-white/[0.06] hover:text-white disabled:pointer-events-none disabled:opacity-35";
export const btnDanger =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border-[0.5px] border-bad/40 bg-bad/[0.06] px-3 text-[11px] font-semibold text-bad transition-colors hover:border-bad/70 hover:bg-bad/15 disabled:pointer-events-none disabled:opacity-35";
export const btnPrimary =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 text-[11px] font-bold text-black transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-30";

/* 16px on phones so iOS doesn't zoom the viewport on focus; 13px from sm up. */
export const inputCls =
  "w-full rounded-lg border-[0.5px] border-edge bg-card px-3 py-2 text-[16px] text-white outline-none transition-colors placeholder:text-[#3a3a3a] focus:border-mut sm:text-[13px]";
export const selectCls =
  "h-9 w-full shrink-0 sm:w-auto rounded-lg border-[0.5px] border-edge bg-card px-2.5 text-[16px] text-body outline-none transition-colors focus:border-mut sm:text-[12px]";

const TONE: Record<string, string> = {
  gold: "text-warn",
  green: "text-ok",
  red: "text-bad",
  heart: "text-heart",
};

/* ---------------------------------- icons ---------------------------------- */

const ICON_PATHS: Record<string, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  approvals: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.9" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l3.6-4.2 3 2.6L20.5 7" />
    </>
  ),
  leaderboards: (
    <>
      <path d="M7.5 4h9v4.8a4.5 4.5 0 0 1-9 0V4z" />
      <path d="M7.5 5.6H4.5v1a3 3 0 0 0 3 3" />
      <path d="M16.5 5.6h3v1a3 3 0 0 1-3 3" />
      <path d="M9.5 20h5" />
      <path d="M12 13.3V20" />
    </>
  ),
  members: (
    <>
      <circle cx="9.5" cy="8" r="3.3" />
      <path d="M3.8 19.6a5.7 5.7 0 0 1 11.4 0" />
      <path d="M16.4 5.4a3.2 3.2 0 0 1 0 5.4" />
      <path d="M17.6 14.2a5.6 5.6 0 0 1 2.7 4.4" />
    </>
  ),
  moderation: (
    <>
      <path d="M12 3.2l7 2.9v5.4c0 4.3-2.9 8-7 9.3-4.1-1.3-7-5-7-9.3V6.1l7-2.9z" />
      <path d="M9.4 12.2l1.9 1.9 3.5-3.7" />
    </>
  ),
  broadcast: (
    <>
      <path d="M4 9.6h3.2L13 5.8v12.4L7.2 14.4H4a1 1 0 0 1-1-1v-2.8a1 1 0 0 1 1-1z" />
      <path d="M16.6 8.8a4.6 4.6 0 0 1 0 6.4" />
      <path d="M19.2 6.4a8 8 0 0 1 0 11.2" />
    </>
  ),
  system: (
    <>
      <rect x="3" y="4" width="18" height="6.5" rx="2" />
      <rect x="3" y="13.5" width="18" height="6.5" rx="2" />
      <path d="M6.6 7.2h.01M6.6 16.8h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.9-3.9" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.2M12 16.3h.01" />
    </>
  ),
};

export function AdminIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}

/* --------------------------------- surfaces -------------------------------- */

// A titled card. `right` renders controls flush-right in the header row,
// `count` a tally pill beside the title, `flush` drops the body padding for
// lists and tables that manage their own gutters.
export function Section({
  title,
  children,
  desc,
  right,
  count,
  flush,
}: {
  title?: string;
  children: React.ReactNode;
  desc?: string;
  right?: React.ReactNode;
  count?: number;
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border-[0.5px] border-field bg-card/50">
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b-[0.5px] border-field px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[13px] font-bold tracking-[-0.1px] text-white">
              {title}
              {count !== undefined && (
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-mut">
                  {count}
                </span>
              )}
            </h2>
            {desc && <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-mut">{desc}</p>}
          </div>
          {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={flush ? "" : "px-4 py-4"}>{children}</div>
    </section>
  );
}

// Sub-header inside a card body — separates stacked groups without nesting
// another card.
export function Rule({ label }: { label: string }) {
  return (
    <p className="mb-2.5 mt-4 text-[10px] font-bold uppercase tracking-[1.5px] text-dim first:mt-0">
      {label}
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border-[0.5px] border-dashed border-field px-4 py-7 text-center text-[12px] leading-relaxed text-dim">
      {children}
    </p>
  );
}

export function Pill({
  children,
  tone = "mut",
}: {
  children: React.ReactNode;
  tone?: "mut" | "ok" | "warn" | "bad" | "white";
}) {
  const cls = {
    mut: "border-edge text-mut",
    ok: "border-ok/40 bg-ok/[0.08] text-ok",
    warn: "border-warn/40 bg-warn/[0.08] text-warn",
    bad: "border-bad/40 bg-bad/[0.08] text-bad",
    white: "border-white/25 bg-white/[0.06] text-white",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-[0.5px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.8px] ${cls}`}
    >
      {children}
    </span>
  );
}

/* ----------------------------------- data ---------------------------------- */

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "gold" | "green" | "red" | "heart";
}) {
  return (
    <div className="rounded-xl border-[0.5px] border-field bg-card px-3.5 py-3 transition-colors hover:border-edge">
      <p className="text-[10px] font-bold uppercase tracking-[1.2px] text-mut">{label}</p>
      <p
        className={`mt-1.5 text-[22px] font-extrabold leading-none tabular-nums tracking-[-0.8px] ${
          tone ? TONE[tone] : "text-white"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11px] leading-snug text-dim">{sub}</p>}
    </div>
  );
}

// Label/value rows — the compact alternative to a wall of stat tiles.
export function Facts({ rows }: { rows: [string, string | number][] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-3 border-b-[0.5px] border-field py-2 text-[12px] last:border-b-0"
        >
          <dt className="min-w-0 truncate text-mut">{k}</dt>
          <dd className="shrink-0 font-bold tabular-nums text-white">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* One row of the list layout every browsable collection uses: thumb, a
   two-line body, actions on the right. */
export function Row({
  lead,
  title,
  meta,
  actions,
  align = "center",
}: {
  lead?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={`flex gap-3 border-b-[0.5px] border-field px-4 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.02] ${
        align === "center" ? "items-center" : "items-start"
      }`}
    >
      {lead}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-snug text-white">{title}</div>
        {meta && <div className="mt-0.5 text-[11px] leading-snug text-dim">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 cursor-pointer accent-white"
    />
  );
}

/* ---------------------------------- charts --------------------------------- */

// HTML bars rather than a stretched SVG: crisp corners, even gaps, and the
// labels stay at their real size at any width.
export function BarChart({
  data,
  height = 120,
}: {
  data: { label: string; v: number }[];
  height?: number;
}) {
  if (!data.length) return <Empty>No data yet.</Empty>;
  const max = Math.max(...data.map((d) => d.v), 1);
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[1.2px] text-dim">
        <span>peak {max.toLocaleString()}</span>
        <span className="tabular-nums">
          total {data.reduce((n, d) => n + d.v, 0).toLocaleString()}
        </span>
      </div>
      <div
        className="flex items-end gap-[3px] border-b-[0.5px] border-edge"
        style={{ height }}
      >
        {data.map((d, i) => (
          <div
            key={i}
            title={`${d.label}: ${d.v}`}
            className="min-w-[2px] flex-1 rounded-t-[3px] bg-white/30 transition-colors hover:bg-white"
            style={{ height: `${Math.max(d.v ? 3 : 1, (d.v / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[9px] font-semibold uppercase tracking-wide text-dim">
        {data.map((d, i) => (
          <span key={i} className="flex-1 overflow-hidden whitespace-nowrap text-center">
            {i % labelEvery === 0 ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

// Single-series area + line with a headline value and an HTML crosshair on
// hover. `tone` is an "r,g,b" string so the fill gradient and stroke share it.
export function AreaChart({
  data,
  height = 140,
  tone = "255,255,255",
  unit = "",
}: {
  data: { label: string; v: number }[];
  height?: number;
  tone?: string;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/[:]/g, "");
  if (!data.length) return <Empty>No data yet.</Empty>;
  const max = Math.max(...data.map((d) => d.v), 1);
  const n = data.length;
  const W = 100;
  const H = 40;
  const px = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const py = (v: number) => H - (v / max) * (H - 3) - 1.5;
  const line = data.map((d, i) => `${px(i).toFixed(2)},${py(d.v).toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const cur = hover != null ? data[hover] : data[n - 1];
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const r = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(r * (n - 1)))));
  };
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[26px] font-extrabold leading-none tabular-nums tracking-[-1px]">
          {cur.v.toLocaleString()}
          {unit}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[1.2px] text-mut">
          {cur.label}
        </span>
      </div>
      <div
        className="relative touch-none border-b-[0.5px] border-edge"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`rgb(${tone})`} stopOpacity="0.30" />
              <stop offset="100%" stopColor={`rgb(${tone})`} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#g${gid})`} />
          <polyline
            points={line}
            fill="none"
            stroke={`rgb(${tone})`}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        {hover != null && (
          <>
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/25"
              style={{ left: `${px(hover)}%` }}
            />
            <div
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-white"
              style={{ left: `${px(hover)}%`, top: `${(py(cur.v) / H) * 100}%` }}
            />
          </>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] font-semibold uppercase tracking-wide text-dim">
        <span>{data[0].label}</span>
        <span>{data[n - 1].label}</span>
      </div>
    </div>
  );
}

// Horizontal proportion bar with a labelled legend — categorical parts of a
// whole in monochrome (each segment a distinct white step + a 2px gap).
export function StackBar({ segments }: { segments: { label: string; v: number }[] }) {
  const total = segments.reduce((n, s) => n + s.v, 0);
  if (!total) return <Empty>No data yet.</Empty>;
  const alphas = [0.9, 0.5, 0.25];
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full">
        {segments.map((s, i) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(s.v / total) * 100}%`,
              background: `rgba(255,255,255,${alphas[i] ?? 0.2})`,
            }}
            title={`${s.label}: ${s.v}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ background: `rgba(255,255,255,${alphas[i] ?? 0.2})` }}
            />
            <span className="text-body">{s.label}</span>
            <span className="font-bold tabular-nums">{Math.round((s.v / total) * 100)}%</span>
            <span className="text-dim tabular-nums">({s.v})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// GitHub-style calendar heatmap of the last `weeks` weeks.
export function Heatmap({ counts, weeks = 26 }: { counts: Map<string, number>; weeks?: number }) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // back to Sunday
  const cols = Math.ceil((today.getTime() - start.getTime()) / (7 * 86_400_000)) + 1;
  const max = Math.max(1, ...counts.values());
  const cells: React.ReactNode[] = [];
  const monthMarks: { x: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < cols; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      if (day > today) continue;
      if (d === 0 && day.getMonth() !== lastMonth) {
        lastMonth = day.getMonth();
        monthMarks.push({
          x: w,
          label: day.toLocaleDateString(undefined, { month: "short" }),
        });
      }
      const v = counts.get(dayKey(day)) ?? 0;
      const alpha = v === 0 ? 0.05 : 0.25 + 0.75 * Math.min(1, v / max);
      cells.push(
        <rect
          key={`${w}-${d}`}
          x={w * 12}
          y={d * 12}
          width={10}
          height={10}
          rx={2}
          fill={`rgba(255,255,255,${alpha.toFixed(2)})`}
        >
          <title>{`${fmtDate(day)}: ${v}`}</title>
        </rect>
      );
    }
  }
  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${cols * 12} ${7 * 12 + 14}`}
          className="h-[110px] min-w-[560px]"
          preserveAspectRatio="xMinYMin meet"
        >
          {cells}
          {monthMarks.map((mk) => (
            <text
              key={mk.x}
              x={mk.x * 12}
              y={7 * 12 + 10}
              className="fill-[#444444]"
              fontSize={8}
              fontWeight={600}
            >
              {mk.label}
            </text>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[9px] font-bold uppercase tracking-[1px] text-dim">
        <span>Less</span>
        {[0.05, 0.3, 0.55, 0.8, 1].map((a) => (
          <span
            key={a}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ background: `rgba(255,255,255,${a})` }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// Ranked list. The top three get metal, matching the podium on profiles.
const MEDAL = ["text-[#d4a017]", "text-[#c0c0c0]", "text-[#cd7f32]"];

export function Board({
  title,
  rows,
  empty = "Nothing yet.",
}: {
  title: string;
  rows: [string, string | number][];
  empty?: string;
}) {
  return (
    <div className="rounded-xl border-[0.5px] border-field bg-card p-3.5">
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[1.5px] text-mut">{title}</p>
      {rows.length === 0 ? (
        <p className="py-2 text-[11px] text-dim">{empty}</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map(([name, v], i) => (
            <li
              key={i}
              className="flex items-baseline justify-between gap-3 border-b-[0.5px] border-field py-1.5 text-[12.5px] last:border-b-0"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  className={`w-3.5 shrink-0 text-right text-[10px] font-extrabold tabular-nums ${
                    MEDAL[i] ?? "text-dim"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="truncate text-body">{name}</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums text-white">{v}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Thumb({ path, size = 44 }: { path: string; size?: number }) {
  const src = useAuthedImage(path, true);
  return (
    <div
      className="shrink-0 overflow-hidden rounded-lg bg-field"
      style={{ width: size, height: size }}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

/* -------------------------------- navigation ------------------------------- */

export type NavItem<T extends string> = { id: T; label: string; badge?: number };

// Desktop: a fixed rail beside the content. It is the primary navigation from
// lg up, where a scrolling pill bar wastes a whole row of chrome.
export function NavRail<T extends string>({
  items,
  active,
  onChange,
  footer,
}: {
  items: NavItem<T>[];
  active: T;
  onChange: (id: T) => void;
  footer?: React.ReactNode;
}) {
  return (
    <aside className="sticky top-[calc(52px+env(safe-area-inset-top))] hidden h-[calc(100dvh-52px)] w-[208px] shrink-0 flex-col gap-1 self-start overflow-y-auto py-6 pr-1 lg:flex">
      <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[1.5px] text-dim">Console</p>
      {items.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-semibold transition-colors ${
              on
                ? "bg-white/[0.08] text-white"
                : "text-mut hover:bg-white/[0.04] hover:text-body"
            }`}
          >
            <AdminIcon name={t.id} className={`h-4 w-4 ${on ? "text-white" : "text-dim"}`} />
            <span className="flex-1 truncate">{t.label}</span>
            {t.badge ? (
              <span className="rounded-full bg-heart px-1.5 py-px text-[9px] font-extrabold tabular-nums text-white">
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </aside>
  );
}

// Phones and tablets: sticky pill bar under the wordmark nav.
export function NavTabs<T extends string>({
  items,
  active,
  onChange,
}: {
  items: NavItem<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="sticky top-[calc(52px+env(safe-area-inset-top))] z-30 -mx-0 border-b-[0.5px] border-line bg-canvas/95 backdrop-blur lg:hidden">
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              aria-current={on ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-colors ${
                on ? "bg-white text-black" : "border-[0.5px] border-edge text-mut hover:text-white"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span
                  className={`rounded-full px-1.5 py-px text-[9px] font-extrabold tabular-nums ${
                    on ? "bg-black text-white" : "bg-heart text-white"
                  }`}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Segmented control for switching views inside one tab.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg border-[0.5px] border-edge bg-card p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-[11.5px] font-semibold transition-colors ${
              on ? "bg-white text-black" : "text-mut hover:text-white"
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`tabular-nums ${on ? "text-black/50" : "text-dim"}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- controls -------------------------------- */

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim">
        <AdminIcon name="search" className="h-3.5 w-3.5" />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} h-9 py-0 pl-8 pr-8`}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-dim transition-colors hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// Prev / next with a "showing x–y of n" readout, so long lists say where you
// are instead of just how many pages there are.
export function Pagination({
  page,
  perPage,
  total,
  onPage,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  const from = page * perPage + 1;
  const to = Math.min(total, (page + 1) * perPage);
  return (
    <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-field px-4 py-3">
      <span className="text-[11px] tabular-nums text-dim">
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <button disabled={page === 0} onClick={() => onPage(page - 1)} className={btn}>
          Prev
        </button>
        <span className="text-[11px] tabular-nums text-mut">
          {page + 1} / {pages}
        </span>
        <button disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className={btn}>
          Next
        </button>
      </div>
    </div>
  );
}

// Sticky-header table wrapper: one place that owns the horizontal scroll and
// the header styling, so every table in the console matches.
export function Table({
  head,
  children,
  minWidth = 720,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]" style={{ minWidth }}>
        <thead>
          <tr className="border-b-[0.5px] border-field text-[9.5px] font-bold uppercase tracking-[1.2px] text-dim">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
