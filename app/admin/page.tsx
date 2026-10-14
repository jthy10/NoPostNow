"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import {
  db,
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { beginTotp, confirmTotp, reauthenticate, type User } from "@/lib/account";
import { site as siteInfo } from "@/lib/site";
import { validateUsername } from "@/lib/settings";
import AccessPanel from "./AccessPanel";
import TopNav from "@/components/TopNav";
import {
  type Announcement,
  type C,
  type Data,
  type LogEntry,
  type P,
  type S,
  type U,
  AdminIcon,
  AreaChart,
  BarChart,
  Board,
  Checkbox,
  Empty,
  Facts,
  Heatmap,
  NavRail,
  NavTabs,
  Pagination,
  Pill,
  Row,
  Rule,
  SearchInput,
  Section,
  Segmented,
  StackBar,
  Stat,
  Table,
  Thumb,
  btn,
  btnDanger,
  btnPrimary,
  byMonth,
  dayKey,
  daysAgo,
  fmtDate,
  fmtDateTime,
  inputCls,
  monthKey,
  monthLabel,
  pct,
  selectCls,
  streaks,
} from "./shared";

/* ---------------------------- content analytics ---------------------------- */

const STOPWORDS = new Set(
  "the a an and or but of to in on at is it its im was for with this that you your are be we our us my me i so not just too have has had do dont did what when how who all out up from they them he she his her got get as if by no yes oh one can will about there here really very much more some than then now when were been being over after before because there's ur u r im".split(
    " "
  )
);

function topWords(texts: string[], n: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const words = t.toLowerCase().replace(/[’']/g, "").match(/[a-z]{3,}/g) ?? [];
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function topEmoji(texts: string[], n: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const m of t.matchAll(/\p{Extended_Pictographic}/gu)) {
      counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// Distinct active people (posted or commented) per month, zero-filled.
function activeMembersMonthly(photos: P[], comments: C[]): { label: string; v: number }[] {
  const byM = new Map<string, Set<string>>();
  const add = (d: Date | null, name: string | null) => {
    if (!d || !name) return;
    const k = monthKey(d);
    if (!byM.has(k)) byM.set(k, new Set());
    byM.get(k)!.add(name);
  };
  for (const p of photos) add(p.timestamp, p.username);
  for (const c of comments) add(c.timestamp, c.username);
  if (!byM.size) return [];
  const keys = [...byM.keys()].sort();
  const [y0, m0] = keys[0].split("-").map(Number);
  const cur = new Date(y0, m0 - 1, 1);
  const now = new Date();
  const out: { label: string; v: number }[] = [];
  while (cur <= now) {
    const k = monthKey(cur);
    out.push({ label: monthLabel(k), v: byM.get(k)?.size ?? 0 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function downloadBlob(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const csvCell = (v: string | number | null | undefined) =>
  `"${String(v ?? "").replace(/"/g, '""')}"`;

// Ids for the optimistic audit-log rows we render before the write lands.
let localLogSeq = 0;

/* ------------------------- TOTP 2FA enrollment card ------------------------- */

function TotpEnrollCard({ onEnrolled }: { onEnrolled: () => void }) {
  const [step, setStep] = useState<"idle" | "scan">("idle");
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setMsg(null);
    try {
      // No password needed here: the console was unlocked with it moments ago.
      const begun = await beginTotp();
      setSecret(begun.secret);
      setQr(await QRCode.toDataURL(begun.uri, { margin: 1, width: 220 }));
      setStep("scan");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't start setup.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!secret) return;
    setBusy(true);
    setMsg(null);
    try {
      await confirmTotp(code.trim());
      onEnrolled();
    } catch {
      setMsg("Wrong code — check the app and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-3 rounded-xl border-[0.5px] border-warn/35 bg-warn/[0.05] p-4">
      <span className="mt-0.5 shrink-0 text-warn">
        <AdminIcon name="alert" className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-bold text-warn">Two-factor authentication is off</p>
        <p className="mt-1 max-w-prose text-[11.5px] leading-relaxed text-mut">
          Add an authenticator app (Google Authenticator, 1Password, Apple Passwords…) so
          logging in to this admin account always needs a 6-digit code. Recommended once
          the site is reachable from the internet.
        </p>
        {msg && <p className="mt-2.5 text-[11.5px] leading-relaxed text-warn">{msg}</p>}

      {step === "idle" && (
        <button onClick={start} disabled={busy} className={`mt-3 ${btn}`}>
          Set up 2FA
        </button>
      )}

      {step === "scan" && secret && (
        <div className="mt-3.5">
          <p className="text-[11.5px] leading-relaxed text-mut">
            1. Scan this with your authenticator app (or enter the key manually).
          </p>
          {qr && (
            <div className="mt-2.5 inline-block rounded-lg bg-white p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="TOTP QR code" className="h-[180px] w-[180px]" />
            </div>
          )}
          <p className="mt-2 break-all text-[10.5px] text-dim">
            Manual key: <span className="font-mono text-mut">{secret}</span>
          </p>
          <p className="mt-3 text-[11.5px] leading-relaxed text-mut">
            2. Enter the 6-digit code it shows:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-32 rounded-lg border-[0.5px] border-edge bg-card px-3 py-1.5 text-center text-[16px] tracking-[4px] outline-none focus:border-mut"
            />
            <button onClick={finish} disabled={busy || code.length !== 6} className={btnPrimary}>
              Enable
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/* ------------------------------ security panel ------------------------------ */

const SESSION_SECONDS = 900; // must match FRESH_ADMIN_MS in server/session.ts

function SecurityPanel({
  user,
  unlockedAt,
  onLock,
}: {
  user: User;
  unlockedAt: number;
  onLock: (reason?: string) => void;
}) {
  // Seeded from the unlock timestamp (a prop, so render stays pure); the
  // interval takes over one second later.
  const [now, setNow] = useState(unlockedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, SESSION_SECONDS - Math.floor((now - unlockedAt) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <Section
      title="Security"
      desc="This session's standing with the server. Admin writes are rejected once the window closes."
      right={
        remaining === 0 ? (
          <button
            onClick={() => onLock("Admin session expired — re-enter your password.")}
            className={btnPrimary}
          >
            Re-unlock
          </button>
        ) : (
          <button onClick={() => onLock()} className={btn}>
            Lock now
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat
          label="Action window"
          value={remaining === 0 ? "Expired" : `${mm}:${ss}`}
          sub={
            remaining === 0
              ? "mutations now rejected server-side"
              : "server rejects mutations after this"
          }
          tone={remaining === 0 ? "red" : remaining < 120 ? "gold" : "green"}
        />
        <Stat
          label="2FA"
          value={user.totpEnabled ? "On" : "Off"}
          sub={user.totpEnabled ? "authenticator app" : "recommended for admins"}
          tone={user.totpEnabled ? "green" : "gold"}
        />
        <Stat label="Signed in as" value="Admin" sub={user.email} />
      </div>
    </Section>
  );
}

// The countdown as a header chip: the one number worth seeing from any tab,
// and a one-click lock. Ticks on its own so the rest of the console doesn't
// re-render every second.
function SessionChip({
  unlockedAt,
  onLock,
}: {
  unlockedAt: number;
  onLock: (reason?: string) => void;
}) {
  const [now, setNow] = useState(unlockedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, SESSION_SECONDS - Math.floor((now - unlockedAt) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const dot =
    remaining === 0 ? "bg-bad" : remaining < 120 ? "bg-warn" : "bg-ok";

  return (
    <button
      onClick={() =>
        onLock(remaining === 0 ? "Admin session expired — re-enter your password." : undefined)
      }
      title={
        remaining === 0
          ? "Session expired — unlock again to make changes"
          : "Time left to make changes before the server stops accepting them"
      }
      className="group inline-flex h-8 items-center gap-2 rounded-lg border-[0.5px] border-edge bg-card px-2.5 transition-colors hover:border-mut lg:w-full"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="text-[11px] font-semibold tabular-nums text-body">
        {remaining === 0 ? "Expired" : `${mm}:${ss}`}
      </span>
      <span className="ml-auto text-[10px] font-bold uppercase tracking-[1px] text-dim transition-colors group-hover:text-white">
        {remaining === 0 ? "Unlock" : "Lock"}
      </span>
    </button>
  );
}

// Exports live behind one menu so the header keeps a single action.
function ExportMenu({
  onJson,
  onPosts,
  onMembers,
}: {
  onJson: () => void;
  onPosts: () => void;
  onMembers: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const item =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-body transition-colors hover:bg-white/[0.06] hover:text-white";

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={btn} aria-expanded={open}>
        <AdminIcon name="download" className="h-3.5 w-3.5" />
        Export
        <AdminIcon
          name="chevron"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-lg border-[0.5px] border-edge bg-card py-1 shadow-[0_12px_30px_rgba(0,0,0,0.6)]">
          <button
            onClick={() => {
              onJson();
              setOpen(false);
            }}
            className={item}
          >
            Everything (JSON)
          </button>
          <button
            onClick={() => {
              onPosts();
              setOpen(false);
            }}
            className={item}
          >
            Posts (CSV)
          </button>
          <button
            onClick={() => {
              onMembers();
              setOpen(false);
            }}
            className={item}
          >
            Members (CSV)
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- broadcast composer ---------------------------- */

function BroadcastComposer({
  deviceCount,
  onSent,
}: {
  deviceCount: number;
  onSent: (message: string, result: string, test: boolean) => void;
}) {
  const [title, setTitle] = useState(() => siteInfo().siteName);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send(test: boolean) {
    if (!message.trim()) return;
    if (
      !test &&
      !confirm(
        `Send this push notification to all ${deviceCount} subscribed devices?\n\n${title}\n${message.trim()}`
      )
    )
      return;
    setBusy(true);
    setResult(null);
    try {
      const json = await apiPost<{ sent: number; stale: number }>("/api/broadcast", {
        title,
        message: message.trim(),
        url: url.trim() || undefined,
        test,
      });
      const summary = `Sent to ${json.sent} device${json.sent === 1 ? "" : "s"}${
        json.stale ? ` · ${json.stale} stale removed` : ""
      }${test ? " (test — your devices only)" : ""}`;
      setResult(summary);
      onSent(message.trim(), summary, test);
      if (!test) setMessage("");
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Broadcast push notification"
      desc={`Goes to every subscribed device — ${deviceCount} right now. Send a test to your own devices first.`}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[1.2px] text-mut">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={40}
            placeholder={siteInfo().siteName}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[1.2px] text-mut">
            Message
            <span className="tabular-nums text-dim">{message.length}/160</span>
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={160}
            rows={3}
            placeholder="Lands on every subscribed lock screen…"
            className={`${inputCls} resize-none`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[1.2px] text-mut">
            Open on tap
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Optional path, e.g. /profile — defaults to the feed"
            className={inputCls}
          />
        </label>

        {message.trim() && (
          <div className="rounded-xl border-[0.5px] border-edge bg-card p-3.5">
            <p className="mb-2 text-[9.5px] font-bold uppercase tracking-[1.5px] text-dim">
              Lock-screen preview
            </p>
            <p className="text-[12.5px] font-bold">{title || siteInfo().siteName}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-body">{message.trim()}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => send(false)}
            disabled={busy || !message.trim()}
            className={btnPrimary}
          >
            Send to all {deviceCount} devices
          </button>
          <button onClick={() => send(true)} disabled={busy || !message.trim()} className={btn}>
            Test on my devices
          </button>
        </div>
        {result && <p className="text-[11.5px] text-mut">{result}</p>}
      </div>
    </Section>
  );
}

/* ------------------------------ deleted photos ------------------------------ */

// What happens to the files behind a deleted post, a replaced avatar or a
// closed account. Off (the default) erases them; on moves them to the data
// folder's deleted/ directory, where only the host can get at them.
function DeletedFilesSetting({ onChange }: { onChange: (keep: boolean) => void }) {
  const [keep, setKeep] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, "config", "deletion"))
      .then((snap) => setKeep(snap.exists() && snap.data().keepFiles === true))
      .catch(() => setKeep(false));
  }, []);

  async function save(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await setDoc(doc(db, "config", "deletion"), { keepFiles: next, updatedAt: serverTimestamp() });
      setKeep(next);
      onChange(next);
      setMsg(next ? "Deleted photos now go to the deleted folder." : "Deleted photos are now erased.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Deleted photos"
      desc="When a post, profile photo or account is deleted, its photos are erased. Turn this on to move them to the deleted folder in the data folder instead. Members can't see or restore them; you can, on the host computer."
      right={keep ? <Pill tone="warn">Kept</Pill> : keep === false ? <Pill>Erased</Pill> : null}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => save(!keep)}
          disabled={busy || keep === null}
          className={keep ? btn : btnPrimary}
        >
          {keep ? "Erase deleted photos" : "Keep deleted photos"}
        </button>
        {msg && <p className="text-[11.5px] text-mut">{msg}</p>}
      </div>
    </Section>
  );
}

/* ---------------------------- announcement manager --------------------------- */

function AnnouncementManager({
  initial,
  onSave,
}: {
  initial: Announcement | null;
  onSave: (text: string, link: string, active: boolean) => Promise<void>;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [active, setActive] = useState(initial?.active ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(nextActive: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await onSave(text.trim(), link.trim(), nextActive);
      setActive(nextActive);
      setMsg(nextActive ? "Live — pinned to the top of everyone's feed." : "Taken down.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Feed announcement"
      desc="A pinned card at the top of the feed. Members can dismiss it; publishing again brings it back for everyone."
      right={active ? <Pill tone="ok">● Live</Pill> : <Pill>Not published</Pill>}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[1.2px] text-mut">
            Text
            <span className="tabular-nums text-dim">{text.length}/200</span>
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="Announcement text…"
            className={`${inputCls} resize-none`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[1.2px] text-mut">Link</span>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Optional path, e.g. /profile"
            className={inputCls}
          />
        </label>
        {text.trim() && (
          <div className="rounded-xl border-[0.5px] border-edge bg-card p-4">
            <p className="mb-2 text-[9.5px] font-bold uppercase tracking-[1.5px] text-dim">
              Feed preview
            </p>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[1.5px] text-mut">
              {siteInfo().siteName}
            </p>
            <p className="text-[13px] leading-relaxed text-body">{text.trim()}</p>
            {link.trim() && (
              <span className="mt-1.5 inline-block text-[11px] font-bold uppercase tracking-[1px]">
                Open →
              </span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => save(true)} disabled={busy || !text.trim()} className={btnPrimary}>
            {active ? "Update" : "Publish"}
          </button>
          {active && (
            <button onClick={() => save(false)} disabled={busy} className={btnDanger}>
              Take down
            </button>
          )}
        </div>
        {msg && <p className="text-[11.5px] text-mut">{msg}</p>}
      </div>
    </Section>
  );
}

/* ------------------------------- member detail ------------------------------- */

function MemberDetail({
  u,
  data,
  live,
  nameOf,
  onDeletePost,
}: {
  u: U;
  data: Data;
  live: P[];
  nameOf: (uid: string | null) => string;
  onDeletePost: (p: P) => void;
}) {
  const posts = live.filter((p) => p.username === u.username);
  const comments = data.comments.filter((c) => c.username === u.username);
  const likesGiven = u.uid
    ? live.reduce((n, p) => n + (p.likedBy.includes(u.uid!) ? 1 : 0), 0)
    : 0;
  const likesRecv = posts.reduce((n, p) => n + p.likedBy.length, 0);
  const devices = u.uid ? data.subs.filter((s) => s.uid === u.uid) : [];
  const activity = [
    ...posts.map((p) => p.timestamp),
    ...comments.map((c) => c.timestamp),
  ].filter((d): d is Date => !!d);
  const lastActive = activity.length
    ? new Date(Math.max(...activity.map((d) => d.getTime())))
    : null;
  const postDays = new Set(posts.filter((p) => p.timestamp).map((p) => dayKey(p.timestamp!)));
  const { longest } = streaks(postDays);
  // Both directions of this member's blocks, keyed on the uid the rest of the
  // app enforces against — a member with no uid can't appear on either side.
  const blocking = u.uid ? (data.blocks.find((b) => b.uid === u.uid)?.blocked ?? []) : [];
  const blockedBy = u.uid
    ? data.blocks.filter((b) => b.blocked.includes(u.uid!)).map((b) => b.uid)
    : [];

  return (
    <div className="rounded-xl border-[0.5px] border-field bg-card p-4">
      <div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
        <Facts
          rows={[
            ["Joined", fmtDate(u.joinedAt)],
            ["Last active", fmtDateTime(lastActive)],
            ["First post", fmtDate(posts.at(-1)?.timestamp ?? null)],
            ["Latest post", fmtDate(posts[0]?.timestamp ?? null)],
          ]}
        />
        <Facts
          rows={[
            ["Posts", posts.length],
            ["Comments", comments.length],
            ["Likes given", likesGiven],
            ["Likes received", likesRecv],
          ]}
        />
        <Facts
          rows={[
            ["Avg ♥ / post", posts.length ? (likesRecv / posts.length).toFixed(1) : "—"],
            ["Longest streak", longest ? `${longest} day${longest === 1 ? "" : "s"}` : "—"],
            ["Push devices", devices.length],
            ["Days active", new Set(activity.map((d) => dayKey(d))).size],
          ]}
        />
      </div>
      {(blocking.length > 0 || blockedBy.length > 0) && (
        <>
          <Rule label="Blocks" />
          <div className="flex flex-col gap-1 text-[11.5px] leading-snug text-body">
            {blocking.length > 0 && (
              <p>
                <span className="text-dim">Blocking</span> {blocking.map(nameOf).join(", ")}
              </p>
            )}
            {blockedBy.length > 0 && (
              <p>
                <span className="text-dim">Blocked by</span> {blockedBy.map(nameOf).join(", ")}
              </p>
            )}
          </div>
        </>
      )}
      {posts.length > 0 && (
        <>
          <Rule label={`Recent posts (${Math.min(posts.length, 8)} of ${posts.length})`} />
          <div className="flex flex-wrap gap-2">
            {posts.slice(0, 8).map((p) => (
              <div key={p.id} className="group relative">
                {p.imagePath ? (
                  <Thumb path={p.imagePath} size={56} />
                ) : (
                  <div className="h-14 w-14 rounded-lg bg-field" />
                )}
                {/* A strip along the bottom, not a cover over the whole photo:
                    on a touch screen there's no hover to reveal it first, so
                    a full-size invisible button turned any tap on the photo
                    into a delete. Always shown where there's no hover. */}
                <button
                  onClick={() => onDeletePost(p)}
                  aria-label="Delete this post"
                  className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/75 py-0.5 text-[8.5px] font-bold uppercase tracking-[1px] text-bad opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The push service a device is registered with. Never throws: one malformed
// entry must not take the whole page down.
function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "invalid address";
  }
}

/* -------------------------------- the page --------------------------------- */

type TabId =
  | "overview"
  | "analytics"
  | "leaderboards"
  | "members"
  | "moderation"
  | "broadcast"
  | "system";

export default function AdminPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedAt, setUnlockedAt] = useState(0);
  const [password, setPassword] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  // True once the password was accepted but an authenticator code is owed.
  const [needsCode, setNeedsCode] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [data, setData] = useState<Data | null>(null);
  // Bumped each time the panel (re)loads from the server. Editors seeded from
  // `data` key off this rather than off the data itself, so they reset on a
  // reload but not on their own save — which used to remount the announcement
  // editor and throw away its "Live" confirmation the instant it appeared.
  const [loadEpoch, setLoadEpoch] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // posts manager state
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"new" | "liked" | "commented">("new");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const PER_PAGE = 15;

  // comment browser state
  const [cSearch, setCSearch] = useState("");
  const [cPage, setCPage] = useState(0);
  const C_PER_PAGE = 20;

  // members
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [mSearch, setMSearch] = useState("");
  const [mSort, setMSort] = useState<
    "name" | "posts" | "comments" | "likes" | "joined" | "active"
  >("posts");

  // moderation sub-view — posts, the trash, or the comment browser
  const [modView, setModView] = useState<"posts" | "trash" | "comments">("posts");

  // active tab
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const isAdmin = user?.isAdmin === true;

  function lock(reason?: string) {
    setUnlocked(false);
    setData(null);
    setLoadError(null);
    setGateError(reason ?? null);
  }

  // Step-up: re-entering the password (and authenticator code, when one is
  // set up) opens a short window in which the server accepts admin changes.
  // Browsing works on the ordinary session; changing things doesn't.
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setGateBusy(true);
    setGateError(null);
    try {
      await reauthenticate(password, needsCode ? totpCode.trim() : undefined);
      setPassword("");
      setTotpCode("");
      setNeedsCode(false);
      setUnlockedAt(Date.now());
      setUnlocked(true);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "mfa-required") setNeedsCode(true);
      else if (code === "mfa-wrong") setGateError("Wrong code — check your authenticator app.");
      else if (code === "too-many-requests") setGateError("Too many attempts — wait a few minutes.");
      else {
        setNeedsCode(false);
        setGateError("Wrong password.");
      }
    } finally {
      setGateBusy(false);
    }
  }

  useEffect(() => {
    if (!unlocked || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const [
          photosSnap,
          commentsSnap,
          usersSnap,
          subsSnap,
          logSnap,
          annSnap,
          fbSnap,
          blocksSnap,
          accountList,
        ] = await Promise.all([
          getDocs(collection(db, "photos")),
          getDocs(collectionGroup(db, "comments")),
          getDocs(collection(db, "users")),
          getDocs(collection(db, "pushSubscriptions")),
          getDocs(collection(db, "adminLog")),
          getDoc(doc(db, "config", "announcement")),
          getDocs(collection(db, "feedback")),
          getDocs(collection(db, "blocks")),
          // Profiles hold no email address; only admins can ask for them.
          apiGet<{ accounts: { uid: string; email: string }[] }>("/api/admin/accounts"),
        ]);
        if (cancelled) return;
        const emailOf = new Map(accountList.accounts.map((a) => [a.uid, a.email]));
        setLoadEpoch((n) => n + 1);
        setData({
          photos: photosSnap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              userUUID: x.userUUID ?? null,
              username: x.username ?? null,
              imagePath: x.imagePath,
              caption: x.caption,
              timestamp: x.timestamp?.toDate?.() ?? null,
              likedBy: Array.isArray(x.likedBy) ? x.likedBy : [],
              imageWidth: x.imageWidth,
              imageHeight: x.imageHeight,
              deleted: x.deleted === true,
              deletedAt: x.deletedAt?.toDate?.() ?? null,
              keys: Object.keys(x),
            };
          }),
          comments: commentsSnap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              postId: d.ref.parent.parent!.id,
              userUUID: x.userUUID ?? null,
              username: x.username ?? null,
              text: x.text ?? "",
              timestamp: x.timestamp?.toDate?.() ?? null,
            };
          }),
          users: usersSnap.docs.map((d) => {
            const x = d.data();
            return {
              email: emailOf.get(d.id) ?? "",
              username: x.username ?? d.id,
              avatarPath: x.avatarPath ?? null,
              uid: d.id,
              joinedAt: x.joinedAt?.toDate?.() ?? x.createdAt?.toDate?.() ?? null,
              muted: x.muted === true,
            };
          }),
          subs: subsSnap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              uid: x.uid ?? null,
              endpoint: x.endpoint ?? "",
              updatedAt: x.updatedAt?.toDate?.() ?? null,
            };
          }),
          blocks: blocksSnap.docs.map((d) => ({
            uid: d.id,
            blocked: (Array.isArray(d.data().blocked) ? d.data().blocked : []).filter(
              (x: unknown): x is string => typeof x === "string" && x.length > 0
            ),
          })),
          log: logSnap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                action: x.action ?? "?",
                detail: x.detail ?? "",
                at: x.at?.toDate?.() ?? null,
              };
            })
            .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)),
          feedback: fbSnap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                uid: x.uid ?? null,
                username: x.username ?? "?",
                email: emailOf.get(x.uid) ?? "",
                text: x.text ?? "",
                at: x.at?.toDate?.() ?? null,
              };
            })
            .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)),
          announcement: annSnap.exists()
            ? {
                text: annSnap.data().text ?? "",
                link: annSnap.data().link ?? "",
                active: annSnap.data().active === true,
                updatedAt: annSnap.data().updatedAt?.toDate?.() ?? null,
              }
            : null,
        });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, user]);

  /* ------------------------------ derived stats ------------------------------ */

  const m = useMemo(() => {
    if (!data) return null;
    const live = data.photos
      .filter((p) => p.timestamp && p.imagePath && !p.deleted)
      .sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime());
    const dead = data.photos.filter((p) => (!p.timestamp || !p.imagePath) && !p.deleted);
    // Soft-deleted by their owner (or an admin) — recoverable from here.
    const trashed = data.photos
      .filter((p) => p.deleted)
      .sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0));

    // uid -> display name (user docs self-heal uid; posts cover the rest)
    const uidName = new Map<string, string>();
    for (const p of live) if (p.userUUID && p.username) uidName.set(p.userUUID, p.username);
    for (const u of data.users) if (u.uid) uidName.set(u.uid, u.username);
    const nameOf = (uid: string | null) =>
      (uid && uidName.get(uid)) || (uid ? `${uid.slice(0, 8)}…` : "Anonymous");

    /* --------------------------------- blocks --------------------------------- */

    // Blocking is enforced in two places that never talk to each other: the
    // push fan-out on the server (/api/notify-post) and every filtered list on
    // the client. Both match on the uids in blocks/{uid}.blocked and nothing
    // else — so a block naming a uid its target doesn't actually act under is
    // a block that silently does nothing, on both sides at once. That is what
    // this view exists to catch; the rows below carry each side's real uid.
    const postsByUid = new Map<string, { posts: number; last: Date | null }>();
    for (const p of live) {
      if (!p.userUUID) continue;
      const cur = postsByUid.get(p.userUUID);
      // `live` is newest-first, so the first sighting is their latest post.
      if (cur) cur.posts += 1;
      else postsByUid.set(p.userUUID, { posts: 1, last: p.timestamp });
    }
    const devicesByUid = new Map<string, number>();
    for (const s of data.subs) {
      if (s.uid) devicesByUid.set(s.uid, (devicesByUid.get(s.uid) ?? 0) + 1);
    }
    const emailOfUid = new Map<string, string>();
    for (const u of data.users) if (u.uid) emailOfUid.set(u.uid, u.email);

    // Display name -> every uid ever seen carrying it. More than one means the
    // same person acts under two logins (a second signup, a hand-backfilled
    // uid), which is exactly how a block ends up aimed at the wrong half.
    const uidsByName = new Map<string, Set<string>>();
    const seenName = (name: string | null, uid: string | null) => {
      if (!name || !uid) return;
      const set = uidsByName.get(name) ?? new Set<string>();
      set.add(uid);
      uidsByName.set(name, set);
    };
    for (const p of live) seenName(p.username, p.userUUID);
    for (const u of data.users) seenName(u.username, u.uid);

    const uidFacts = (uid: string) => {
      const activity = postsByUid.get(uid);
      return {
        uid,
        name: uidName.get(uid) ?? null,
        email: emailOfUid.get(uid) ?? null,
        posts: activity?.posts ?? 0,
        lastPost: activity?.last ?? null,
        devices: devicesByUid.get(uid) ?? 0,
        // Anything the database can tie to a person: a post, a users doc, or
        // a login record.
        known: uidName.has(uid) || emailOfUid.has(uid),
      };
    };

    const edgeKey = (from: string, to: string) => `${from}>${to}`;
    const rawEdges = data.blocks.flatMap((b) => b.blocked.map((to) => ({ from: b.uid, to })));
    const edgeSet = new Set(rawEdges.map((e) => edgeKey(e.from, e.to)));
    const blockEdges = rawEdges
      .map((e) => {
        const from = uidFacts(e.from);
        const to = uidFacts(e.to);
        // Other uids carrying the target's name, ranked by who actually posts —
        // if the blocked uid isn't the one posting, the block misses.
        const twins = [...(uidsByName.get(to.name ?? "") ?? [])]
          .filter((u) => u !== to.uid)
          .sort((a, b) => (postsByUid.get(b)?.posts ?? 0) - (postsByUid.get(a)?.posts ?? 0));
        const liveTwin = twins.find((u) => (postsByUid.get(u)?.posts ?? 0) > 0) ?? null;
        const problem = !to.known
          ? "This uid matches no post, member or login — nothing can ever match it."
          : to.posts === 0 && liveTwin
            ? `${to.name} posts under a different uid, so this block never fires on their posts.`
            : null;
        return { ...e, from, to, mutual: edgeSet.has(edgeKey(e.to, e.from)), problem, liveTwin };
      })
      // Anything broken first — that's the only reason to open this list in a
      // hurry — then alphabetical by who blocked whom.
      .sort(
        (a, b) =>
          Number(Boolean(b.problem)) - Number(Boolean(a.problem)) ||
          (a.from.name ?? a.from.uid).localeCompare(b.from.name ?? b.from.uid) ||
          (a.to.name ?? a.to.uid).localeCompare(b.to.name ?? b.to.uid)
      );
    const brokenBlocks = blockEdges.filter((e) => e.problem);
    // Counted once per pair, not once per direction.
    const mutualBlocks = blockEdges.filter((e) => e.mutual && e.from.uid < e.to.uid).length;

    const commentsByPost = new Map<string, number>();
    for (const c of data.comments)
      commentsByPost.set(c.postId, (commentsByPost.get(c.postId) ?? 0) + 1);

    const count = <T,>(items: T[], key: (t: T) => string | null) => {
      const map = new Map<string, number>();
      for (const it of items) {
        const k = key(it);
        if (k) map.set(k, (map.get(k) ?? 0) + 1);
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };

    const totalLikes = live.reduce((n, p) => n + p.likedBy.length, 0);
    const captioned = live.filter((p) => p.caption?.trim());
    const postDates = live.map((p) => p.timestamp!);

    const perDay = count(live, (p) => p.timestamp!.toDateString());
    const hourHist = Array.from({ length: 24 }, (_, h) => ({
      label: `${h}`,
      v: live.filter((p) => p.timestamp!.getHours() === h).length,
    }));
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekdayHist = dayNames.map((label, i) => ({
      label,
      v: live.filter((p) => p.timestamp!.getDay() === i).length,
    }));

    // cumulative posts growth
    const postsMonthly = byMonth(postDates);
    let pacc = 0;
    const postsGrowth = postsMonthly.map((x) => ({ label: x.label, v: (pacc += x.v) }));

    const likesReceived = count(live, (p) => p.username || "Anonymous").map(
      ([name]) =>
        [
          name,
          live
            .filter((p) => (p.username || "Anonymous") === name)
            .reduce((n, p) => n + p.likedBy.length, 0),
        ] as [string, number]
    );
    likesReceived.sort((a, b) => b[1] - a[1]);

    const likesGiven = count(
      live.flatMap((p) => p.likedBy),
      (uid) => nameOf(uid)
    );

    const activeSince30 = new Set([
      ...live.filter((p) => p.timestamp!.getTime() > daysAgo(30)).map((p) => p.username || ""),
      ...data.comments
        .filter((c) => c.timestamp && c.timestamp.getTime() > daysAgo(30))
        .map((c) => c.username || ""),
    ]);
    activeSince30.delete("");

    // ---- new: streaks, heatmap, activity, content, health ----

    const postDaySet = new Set(postDates.map((d) => dayKey(d)));
    const siteStreaks = streaks(postDaySet);
    const lastPost = live[0]?.timestamp ?? null;
    const daysSinceLastPost = lastPost
      ? Math.floor((daysAgo(0) - lastPost.getTime()) / 86_400_000)
      : null;

    const heatCounts = new Map<string, number>();
    for (const d of postDates) heatCounts.set(dayKey(d), (heatCounts.get(dayKey(d)) ?? 0) + 1);
    for (const c of data.comments)
      if (c.timestamp)
        heatCounts.set(dayKey(c.timestamp), (heatCounts.get(dayKey(c.timestamp)) ?? 0) + 1);

    // per-user longest posting streaks
    const daysByUser = new Map<string, Set<string>>();
    for (const p of live) {
      const name = p.username || "Anonymous";
      if (!daysByUser.has(name)) daysByUser.set(name, new Set());
      daysByUser.get(name)!.add(dayKey(p.timestamp!));
    }
    const userStreaks = [...daysByUser.entries()]
      .map(([name, days]) => [name, streaks(days).longest] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([n, v]) => [n, `${v} day${v === 1 ? "" : "s"}`] as [string, string]);

    const nightOwls = count(
      live.filter((p) => p.timestamp!.getHours() < 6),
      (p) => p.username || "Anonymous"
    ).slice(0, 8);

    // last activity per username (posts + comments)
    const lastActive = new Map<string, Date>();
    const bump = (name: string | null, d: Date | null) => {
      if (!name || !d) return;
      const cur = lastActive.get(name);
      if (!cur || d > cur) lastActive.set(name, d);
    };
    for (const p of live) bump(p.username, p.timestamp);
    for (const c of data.comments) bump(c.username, c.timestamp);

    const lurkers = data.users.filter(
      (u) =>
        !live.some((p) => p.username === u.username) &&
        !data.comments.some((c) => c.username === u.username)
    );

    // content analytics
    const captionTexts = captioned.map((p) => p.caption!);
    const commentTexts = data.comments.map((c) => c.text);
    const words = topWords([...captionTexts, ...commentTexts], 14);
    const emoji = topEmoji([...captionTexts, ...commentTexts], 8);
    const avgCommentLen = data.comments.length
      ? Math.round(commentTexts.reduce((n, t) => n + t.length, 0) / data.comments.length)
      : 0;

    // aspect ratios
    const withDims = live.filter((p) => p.imageWidth && p.imageHeight);
    const aspect = { portrait: 0, landscape: 0, square: 0 };
    for (const p of withDims) {
      const r = p.imageWidth! / p.imageHeight!;
      if (r > 1.05) aspect.landscape++;
      else if (r < 0.95) aspect.portrait++;
      else aspect.square++;
    }

    // data health
    const liveIds = new Set(data.photos.map((p) => p.id));
    const orphanComments = data.comments.filter((c) => !liveIds.has(c.postId));
    const knownUids = new Set(uidName.keys());
    const ghostLikes = live.reduce(
      (n, p) => n + p.likedBy.filter((uid) => !knownUids.has(uid)).length,
      0
    );

    return {
      live,
      dead,
      trashed,
      nameOf,
      blockEdges,
      brokenBlocks,
      mutualBlocks,
      commentsByPost,
      totalLikes,
      captioned,
      perDay,
      hourHist,
      weekdayHist,
      postsGrowth,
      postsMonthly,
      commentsMonthly: byMonth(
        data.comments.map((c) => c.timestamp).filter((d): d is Date => !!d)
      ),
      activeMonthly: activeMembersMonthly(live, data.comments),
      topPosters: count(live, (p) => p.username || "Anonymous").slice(0, 8),
      topCommenters: count(data.comments, (c) => c.username).slice(0, 8),
      likesGiven: likesGiven.slice(0, 8),
      likesReceived: likesReceived.slice(0, 8),
      userStreaks,
      nightOwls,
      topLiked: [...live].sort((a, b) => b.likedBy.length - a.likedBy.length).slice(0, 5),
      topCommented: [...live]
        .sort((a, b) => (commentsByPost.get(b.id) ?? 0) - (commentsByPost.get(a.id) ?? 0))
        .slice(0, 5),
      posts7: live.filter((p) => p.timestamp!.getTime() > daysAgo(7)).length,
      posts30: live.filter((p) => p.timestamp!.getTime() > daysAgo(30)).length,
      comments30: data.comments.filter((c) => c.timestamp && c.timestamp.getTime() > daysAgo(30))
        .length,
      activeSince30: activeSince30.size,
      noDims: live.filter((p) => !p.imageWidth).length,
      anonPosts: live.filter((p) => !p.userUUID).length,
      siteStreaks,
      daysSinceLastPost,
      heatCounts,
      lastActive,
      lurkers,
      words,
      emoji,
      avgCommentLen,
      aspect,
      withDims: withDims.length,
      orphanComments,
      ghostLikes,
    };
  }, [data]);

  /* ------------------------------ admin actions ------------------------------ */

  // Append-only audit trail — rules allow create (never update/delete) and
  // only within the fresh-admin window. Fire-and-forget: logging must never
  // block the action it describes.
  function log(action: string, detail: string) {
    void addDoc(collection(db, "adminLog"), {
      action,
      detail: detail.slice(0, 300),
      at: serverTimestamp(),
    }).catch(() => {});
    const entry: LogEntry = {
      id: `local-${localLogSeq++}`,
      action,
      detail: detail.slice(0, 300),
      at: new Date(),
    };
    setData((d) => d && { ...d, log: [entry, ...d.log] });
  }

  // freshAdmin() expired server-side → force the password gate again.
  function handleActionError(e: unknown) {
    if (e instanceof Error && /permission/i.test(e.message)) {
      lock("Admin session expired — re-enter your password.");
    } else {
      alert(e instanceof Error ? e.message : "Action failed.");
    }
  }

  // Runs a bulk action one item at a time and keeps going past a failure, so
  // the panel can update for exactly the items that went through. Stopping
  // at the first error (and updating nothing) left the screen showing items
  // as still there that were already gone on the server, and vice versa.
  // A lapsed admin session is the exception: every later write would fail
  // the same way, so it stops there.
  async function eachSettled<T>(items: T[], run: (item: T) => Promise<void>) {
    const done: T[] = [];
    let failed = 0;
    let firstError: unknown = null;
    for (const item of items) {
      try {
        await run(item);
        done.push(item);
      } catch (e) {
        failed++;
        firstError ??= e;
        if (e instanceof Error && /permission/i.test(e.message)) {
          failed = items.length - done.length;
          break;
        }
      }
    }
    return { done, failed, firstError };
  }

  function reportBulk(what: string, failed: number, firstError: unknown) {
    if (!failed) return;
    if (firstError instanceof Error && /permission/i.test(firstError.message)) {
      handleActionError(firstError);
      return;
    }
    const reason = firstError instanceof Error ? ` (${firstError.message})` : "";
    alert(`${failed} ${what} failed${reason}. The rest went through; the failed ones are left as they were.`);
  }

  // Deletes the photo doc and its comment subcollection (otherwise the
  // comments linger as orphans that only show up in Data health).
  async function deletePostAndComments(p: P) {
    if (!data) return;
    for (const c of data.comments.filter((c) => c.postId === p.id)) {
      await deleteDoc(doc(db, "photos", p.id, "comments", c.id));
    }
    await deleteDoc(doc(db, "photos", p.id));
  }

  async function adminDeletePost(p: P) {
    if (!confirm(`Delete this post by ${p.username || "Anonymous"}? This can't be undone.`))
      return;
    try {
      await deletePostAndComments(p);
      setData(
        (d) =>
          d && {
            ...d,
            photos: d.photos.filter((x) => x.id !== p.id),
            comments: d.comments.filter((c) => c.postId !== p.id),
          }
      );
      log("delete-post", `${p.username || "Anonymous"} — ${p.caption || "(no caption)"} · ${p.id}`);
    } catch (e) {
      handleActionError(e);
    }
  }

  async function bulkDeletePosts() {
    if (!m || selected.size === 0) return;
    const targets = m.live.filter((p) => selected.has(p.id));
    if (
      !confirm(`Delete ${targets.length} selected posts? This can't be undone.`) ||
      !confirm("Really sure? This permanently deletes them and their comments.")
    )
      return;
    const { done, failed, firstError } = await eachSettled(targets, deletePostAndComments);
    const ids = new Set(done.map((p) => p.id));
    if (ids.size) {
      setData(
        (d) =>
          d && {
            ...d,
            photos: d.photos.filter((x) => !ids.has(x.id)),
            comments: d.comments.filter((c) => !ids.has(c.postId)),
          }
      );
      // Failed ones stay selected, ready for another go.
      setSelected((sel) => new Set([...sel].filter((id) => !ids.has(id))));
      log("bulk-delete-posts", `${ids.size} posts`);
    }
    reportBulk("deletes", failed, firstError);
  }

  async function adminDeleteComment(c: C) {
    if (!confirm(`Delete this comment by ${c.username}?`)) return;
    try {
      await deleteDoc(doc(db, "photos", c.postId, "comments", c.id));
      setData((d) => d && { ...d, comments: d.comments.filter((x) => x.id !== c.id) });
      log("delete-comment", `${c.username}: “${c.text.slice(0, 80)}”`);
    } catch (e) {
      handleActionError(e);
    }
  }

  async function adminDeleteSub(s: S) {
    if (!confirm("Remove this push device? They can re-enable it in the app.")) return;
    try {
      await deleteDoc(doc(db, "pushSubscriptions", s.id));
      setData((d) => d && { ...d, subs: d.subs.filter((x) => x.id !== s.id) });
      log("remove-device", `${m?.nameOf(s.uid) ?? s.uid ?? "unknown"} · ${endpointHost(s.endpoint)}`);
    } catch (e) {
      handleActionError(e);
    }
  }

  async function adminRename(u: U) {
    const next = prompt(
      `New username for ${u.email}?\n(All their old posts and comments get the new name too.)`,
      u.username
    )?.trim();
    if (!next || next === u.username || !data) return;
    const problem = validateUsername(next);
    if (problem) {
      alert(problem);
      return;
    }
    if (
      data.users.some(
        (x) => x.email !== u.email && x.username.toLowerCase() === next.toLowerCase()
      )
    ) {
      alert(`“${next}” is already taken by another member.`);
      return;
    }
    try {
      await setDoc(doc(db, "users", u.uid!), { username: next }, { merge: true });
      // Restamp their old posts and comments (matched by uid when the doc
      // has one, else by the old username — pre-self-heal accounts).
      const myPost = (p: P) => (u.uid ? p.userUUID === u.uid : p.username === u.username);
      const myComment = (c: C) => (u.uid ? c.userUUID === u.uid : c.username === u.username);
      const results = await Promise.allSettled([
        ...data.photos.filter(myPost).map((p) =>
          setDoc(doc(db, "photos", p.id), { username: next }, { merge: true })
        ),
        ...data.comments.filter(myComment).map((c) =>
          setDoc(doc(db, "photos", c.postId, "comments", c.id), { username: next }, { merge: true })
        ),
      ]);
      const failed = results.filter((r) => r.status === "rejected").length;
      setData(
        (d) =>
          d && {
            ...d,
            users: d.users.map((x) => (x.email === u.email ? { ...x, username: next } : x)),
            photos: d.photos.map((p) => (myPost(p) ? { ...p, username: next } : p)),
            comments: d.comments.map((c) => (myComment(c) ? { ...c, username: next } : c)),
          }
      );
      log(
        "rename-user",
        `${u.email}: ${u.username} → ${next} (${results.length - failed} posts/comments restamped${failed ? `, ${failed} failed` : ""})`
      );
      if (failed) alert(`${failed} old posts/comments couldn't be updated — rerun the rename to retry.`);
    } catch (e) {
      handleActionError(e);
    }
  }

  async function adminRecoverPost(p: P) {
    try {
      await setDoc(doc(db, "photos", p.id), { deleted: false }, { merge: true });
      setData(
        (d) =>
          d && {
            ...d,
            photos: d.photos.map((x) => (x.id === p.id ? { ...x, deleted: false } : x)),
          }
      );
      log("recover-post", `${p.username || "Anonymous"} — ${p.caption || "(no caption)"} · ${p.id}`);
    } catch (e) {
      handleActionError(e);
    }
  }

  async function adminDeleteFeedback(id: string) {
    if (!confirm("Remove this note?")) return;
    try {
      await deleteDoc(doc(db, "feedback", id));
      setData((d) => d && { ...d, feedback: d.feedback.filter((f) => f.id !== id) });
    } catch (e) {
      handleActionError(e);
    }
  }

  async function adminSetMuted(u: U, muted: boolean) {
    if (
      !confirm(
        muted
          ? `Mute ${u.username}? They can still browse and like, but can't post or comment (enforced server-side) until unmuted.`
          : `Unmute ${u.username}? They can post and comment again.`
      )
    )
      return;
    try {
      await setDoc(doc(db, "users", u.uid!), { muted }, { merge: true });
      setData(
        (d) =>
          d && { ...d, users: d.users.map((x) => (x.email === u.email ? { ...x, muted } : x)) }
      );
      log(muted ? "mute-user" : "unmute-user", `${u.username} (${u.email})`);
    } catch (e) {
      handleActionError(e);
    }
  }

  async function sweepDeadDocs() {
    if (!m || !m.dead.length) return;
    if (
      !confirm(
        `Delete all ${m.dead.length} dead photo docs? These have no timestamp or image path and never render in the feed. This can't be undone.`
      ) ||
      !confirm("Really sure? This permanently deletes them.")
    )
      return;
    const { done, failed, firstError } = await eachSettled(m.dead, (p) =>
      deleteDoc(doc(db, "photos", p.id))
    );
    const ids = new Set(done.map((p) => p.id));
    setData((d) => d && { ...d, photos: d.photos.filter((p) => !ids.has(p.id)) });
    if (ids.size) log("sweep-dead-docs", `${ids.size} docs`);
    reportBulk("deletes", failed, firstError);
  }

  async function sweepOrphanComments() {
    if (!m || !m.orphanComments.length) return;
    if (
      !confirm(
        `Delete ${m.orphanComments.length} orphaned comments? Their parent posts are already gone — these can never be seen in the app.`
      )
    )
      return;
    const { done, failed, firstError } = await eachSettled(m.orphanComments, (c) =>
      deleteDoc(doc(db, "photos", c.postId, "comments", c.id))
    );
    const ids = new Set(done.map((c) => c.id));
    setData((d) => d && { ...d, comments: d.comments.filter((c) => !ids.has(c.id)) });
    if (ids.size) log("sweep-orphan-comments", `${ids.size} comments`);
    reportBulk("deletes", failed, firstError);
  }

  async function saveAnnouncement(text: string, link: string, active: boolean) {
    try {
      await setDoc(doc(db, "config", "announcement"), {
        text,
        link,
        active,
        updatedAt: serverTimestamp(),
      });
      setData(
        (d) => d && { ...d, announcement: { text, link, active, updatedAt: new Date() } }
      );
      log(active ? "publish-announcement" : "takedown-announcement", text.slice(0, 100));
    } catch (e) {
      handleActionError(e);
      throw e;
    }
  }

  /* --------------------------------- exports --------------------------------- */

  function exportJson() {
    if (!data) return;
    downloadBlob(
      `nopostnow-export-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
      JSON.stringify(data, null, 2)
    );
  }

  function exportPostsCsv() {
    if (!m) return;
    const rows = [
      ["id", "username", "caption", "timestamp", "likes", "comments", "width", "height"],
      ...m.live.map((p) => [
        p.id,
        p.username || "Anonymous",
        p.caption || "",
        p.timestamp?.toISOString() ?? "",
        p.likedBy.length,
        m.commentsByPost.get(p.id) ?? 0,
        p.imageWidth ?? "",
        p.imageHeight ?? "",
      ]),
    ];
    downloadBlob(
      `nopostnow-posts-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv",
      rows.map((r) => r.map(csvCell).join(",")).join("\n")
    );
  }

  function exportMembersCsv() {
    if (!data || !m) return;
    const rows = [
      ["email", "username", "joined", "last_active", "posts", "comments", "likes_received", "muted"],
      ...data.users.map((u) => {
        const posts = m.live.filter((p) => p.username === u.username);
        return [
          u.email,
          u.username,
          u.joinedAt?.toISOString() ?? "",
          m.lastActive.get(u.username)?.toISOString() ?? "",
          posts.length,
          data.comments.filter((c) => c.username === u.username).length,
          posts.reduce((n, p) => n + p.likedBy.length, 0),
          u.muted ? "yes" : "no",
        ];
      }),
    ];
    downloadBlob(
      `nopostnow-members-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv",
      rows.map((r) => r.map(csvCell).join(",")).join("\n")
    );
  }

  /* --------------------------------- render ---------------------------------- */

  if (loading || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-[11px] font-bold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  // Rules enforce this server-side; non-admins just get an empty page.
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm text-mut">
        Nothing here.
      </div>
    );
  }

  if (!unlocked) {
    const onTotp = needsCode;
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <form
          onSubmit={unlock}
          className="w-full max-w-[360px] rounded-2xl border-[0.5px] border-field bg-card/50 p-6"
        >
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border-[0.5px] border-edge bg-card text-mut">
            <AdminIcon name="lock" className="h-5 w-5" />
          </div>
          <h1 className="text-center text-[15px] font-extrabold tracking-[-0.2px]">
            Admin console
          </h1>
          <p className="mb-5 mt-1.5 text-center text-[11.5px] leading-relaxed text-mut">
            {onTotp
              ? "Enter the 6-digit code from your authenticator app."
              : "Re-enter your password. Admin actions stay valid for 15 minutes after this check — enforced server-side."}
          </p>
          {gateError && (
            <p className="mb-3 rounded-lg border-[0.5px] border-bad/40 bg-bad/[0.06] px-3.5 py-2.5 text-[12px] leading-relaxed text-bad">
              {gateError}
            </p>
          )}
          {onTotp ? (
            <input
              type="text"
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-full rounded-lg border-[0.5px] border-edge bg-card px-3.5 py-3 text-center text-xl tracking-[8px] outline-none transition-colors placeholder:text-[#2e2e2e] focus:border-mut"
            />
          ) : (
            <input
              type="password"
              autoFocus
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border-[0.5px] border-edge bg-card px-3.5 py-3 text-[16px] outline-none transition-colors placeholder:text-[#2e2e2e] focus:border-mut"
            />
          )}
          <button
            type="submit"
            disabled={gateBusy || (onTotp ? totpCode.length !== 6 : !password)}
            className="mt-3 w-full rounded-lg bg-white p-3 text-[13px] font-extrabold text-black transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            {onTotp ? "Verify" : "Unlock"}
          </button>
          {onTotp && (
            // A phone without the authenticator to hand, or the wrong account's
            // password, still lands here — and the only exit used to be
            // reloading the page.
            <button
              type="button"
              onClick={() => {
                setNeedsCode(false);
                setTotpCode("");
                setPassword("");
                setGateError(null);
              }}
              className="mt-4 w-full text-center text-xs text-dim transition-colors hover:text-white"
            >
              Back to password
            </button>
          )}
          <p className="mt-4 truncate text-center text-[10px] text-dim">{user.email}</p>
        </form>
      </main>
    );
  }

  if (loadError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center px-6 text-center text-sm text-bad">
        {loadError}
      </div>
    );
  }

  if (!data || !m) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-[11px] font-bold uppercase tracking-[2px] text-mut">
        Crunching numbers…
      </div>
    );
  }

  /* ------------------------------ derived views ------------------------------ */

  const filteredPosts = m.live.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.username || "anonymous").toLowerCase().includes(q) ||
      (p.caption || "").toLowerCase().includes(q)
    );
  });
  const sortedPosts = [...filteredPosts].sort((a, b) =>
    sort === "liked"
      ? b.likedBy.length - a.likedBy.length
      : sort === "commented"
        ? (m.commentsByPost.get(b.id) ?? 0) - (m.commentsByPost.get(a.id) ?? 0)
        : 0
  );
  // Deleting the last rows of the last page shrinks the list out from under
  // the page number — clamp so the panel steps back a page instead of
  // sitting on an empty one with the pager still pointing past the end.
  const lastPage = (total: number, per: number) => Math.max(0, Math.ceil(total / per) - 1);
  const postPage = Math.min(page, lastPage(sortedPosts.length, PER_PAGE));
  const pagePosts = sortedPosts.slice(postPage * PER_PAGE, (postPage + 1) * PER_PAGE);

  const filteredComments = [...data.comments]
    .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
    .filter((c) => {
      const q = cSearch.trim().toLowerCase();
      if (!q) return true;
      return (c.username || "").toLowerCase().includes(q) || c.text.toLowerCase().includes(q);
    });
  const commentPage = Math.min(cPage, lastPage(filteredComments.length, C_PER_PAGE));
  const pageComments = filteredComments.slice(
    commentPage * C_PER_PAGE,
    (commentPage + 1) * C_PER_PAGE
  );

  // One pass per member, then filter + sort — the table header drives both.
  const memberRows = data.users
    .map((u) => {
      const posts = m.live.filter((p) => p.username === u.username);
      return {
        u,
        posts: posts.length,
        comments: data.comments.filter((c) => c.username === u.username).length,
        likes: posts.reduce((n, p) => n + p.likedBy.length, 0),
        last: m.lastActive.get(u.username) ?? null,
      };
    })
    .filter(({ u }) => {
      const q = mSearch.trim().toLowerCase();
      return !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (mSort === "name") return a.u.username.localeCompare(b.u.username);
      if (mSort === "comments") return b.comments - a.comments;
      if (mSort === "likes") return b.likes - a.likes;
      if (mSort === "joined") return (b.u.joinedAt?.getTime() ?? 0) - (a.u.joinedAt?.getTime() ?? 0);
      if (mSort === "active") return (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0);
      return b.posts - a.posts;
    });

  const subsByUid = new Map<string, S[]>();
  for (const s of data.subs) {
    const k = s.uid ?? "unknown";
    subsByUid.set(k, [...(subsByUid.get(k) ?? []), s]);
  }

  const engagement = m.live.length
    ? ((m.totalLikes + data.comments.length) / m.live.length).toFixed(1)
    : "—";

  const healthIssues = m.dead.length + m.orphanComments.length;
  const mutedCount = data.users.filter((u) => u.muted).length;

  const NAV: { id: TabId; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "analytics", label: "Analytics" },
    { id: "leaderboards", label: "Leaderboards" },
    { id: "members", label: "Members", badge: data.feedback.length || undefined },
    { id: "moderation", label: "Moderation" },
    { id: "broadcast", label: "Broadcast" },
    { id: "system", label: "System", badge: healthIssues || undefined },
  ];

  // Anything sitting in a queue gets surfaced on Overview rather than waiting
  // to be found in a tab.
  const attention: { id: TabId; label: string; n: number; tone: "warn" | "bad" | "white" }[] = [];
  if (data.feedback.length)
    attention.push({
      id: "members",
      label: `member note${data.feedback.length === 1 ? "" : "s"} to read`,
      n: data.feedback.length,
      tone: "white",
    });
  if (healthIssues)
    attention.push({
      id: "system",
      label: "data health issue" + (healthIssues === 1 ? "" : "s") + " to sweep",
      n: healthIssues,
      tone: "bad",
    });
  if (mutedCount)
    attention.push({
      id: "members",
      label: `member${mutedCount === 1 ? "" : "s"} currently muted`,
      n: mutedCount,
      tone: "warn",
    });
  // A block that can't match anyone is worse than no block: the person who set
  // it believes they're invisible to someone who still sees everything.
  if (m.brokenBlocks.length)
    attention.push({
      id: "members",
      label: `block${m.brokenBlocks.length === 1 ? "" : "s"} that can't match anyone`,
      n: m.brokenBlocks.length,
      tone: "bad",
    });

  const memberActions = (u: U, open: boolean) => (
    <>
      <button onClick={() => setOpenMember(open ? null : u.email)} className={btn}>
        {open ? "Close" : "Details"}
      </button>
      <button onClick={() => adminRename(u)} className={btn}>
        Rename
      </button>
      <button onClick={() => adminSetMuted(u, !u.muted)} className={u.muted ? btn : btnDanger}>
        {u.muted ? "Unmute" : "Mute"}
      </button>
    </>
  );

  const memberName = (u: U) => (
    <span className="flex items-center gap-1.5">
      <Link href={`/u/${u.uid}`} target="_blank" className="truncate font-semibold hover:underline">
        {u.username}
      </Link>
      {u.muted && <Pill tone="bad">Muted</Pill>}
    </span>
  );

  // A raw uid, readable at a glance and copyable in full from the tooltip —
  // the whole point of the blocks view is comparing these against each other.
  const uidChip = (uid: string) => (
    <code
      title={uid}
      className="rounded border-[0.5px] border-edge bg-white/[0.04] px-1 py-0.5 font-mono text-[10px] text-mut"
    >
      {uid.slice(0, 12)}…
    </code>
  );

  const memberAvatar = (u: U) => (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[0.5px] border-edge bg-field text-[11px] font-bold uppercase text-mut">
      {u.username.slice(0, 1)}
    </span>
  );

  const postRowActions = (p: P) => (
    <>
      <span className="hidden sm:block">
        <Link href={`/p/${p.id}`} target="_blank" className={btn}>
          Open
        </Link>
      </span>
      <button onClick={() => adminDeletePost(p)} className={btnDanger}>
        Delete
      </button>
    </>
  );

  return (
    <>
      <TopNav />
      <div className="mx-auto flex w-full max-w-[1440px] gap-6 pt-[calc(52px+env(safe-area-inset-top))] lg:px-6">
        <NavRail
          items={NAV}
          active={tab}
          onChange={setTab}
          footer={<SessionChip unlockedAt={unlockedAt} onLock={lock} />}
        />

        <main className="min-w-0 flex-1 pb-24">
          {/* Page header: who/what, the live counts, and the exports. */}
          <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-4 pb-4 pt-5 lg:px-0 lg:pt-6">
            <div className="min-w-0">
              <h1 className="text-[22px] font-extrabold tracking-[-0.6px] sm:text-2xl">
                {NAV.find((t) => t.id === tab)?.label ?? "Admin"}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-mut">
                <span className="tabular-nums">{m.live.length.toLocaleString()} posts</span>
                <span className="text-dim">·</span>
                <span className="tabular-nums">{data.users.length} members</span>
                <span className="text-dim">·</span>
                <span className="tabular-nums">{data.subs.length} devices</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="lg:hidden">
                <SessionChip unlockedAt={unlockedAt} onLock={lock} />
              </span>
              <ExportMenu
                onJson={exportJson}
                onPosts={exportPostsCsv}
                onMembers={exportMembersCsv}
              />
            </div>
          </header>

          <NavTabs items={NAV} active={tab} onChange={setTab} />

          {(tab === "overview" || tab === "system") &&
            !user.totpEnabled && (
            <div className="px-3 pt-4 sm:px-4 lg:px-0">
              <TotpEnrollCard
                onEnrolled={() => {
                  void refresh();
                  lock(
                    "2FA enabled. Unlock again — from now on you'll need your password and a code."
                  );
                }}
              />
            </div>
            )}

          <div className="flex flex-col gap-4 px-3 py-4 sm:px-4 lg:px-0 lg:py-6">
            {/* -------------------------------- overview ------------------------------- */}
            {tab === "overview" && (
              <>
                {attention.length > 0 && (
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                    {attention.map((a) => (
                      <button
                        key={a.label}
                        onClick={() => setTab(a.id)}
                        className="flex items-center gap-3 rounded-xl border-[0.5px] border-field bg-card px-3.5 py-3 text-left transition-colors hover:border-edge"
                      >
                        <span
                          className={`text-[22px] font-extrabold leading-none tabular-nums tracking-[-0.8px] ${
                            a.tone === "bad"
                              ? "text-bad"
                              : a.tone === "warn"
                                ? "text-warn"
                                : "text-white"
                          }`}
                        >
                          {a.n}
                        </span>
                        <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-mut">
                          {a.label}
                        </span>
                        <AdminIcon name="chevron" className="h-4 w-4 -rotate-90 text-dim" />
                      </button>
                    ))}
                  </div>
                )}

                <Section title="Key metrics" desc="Everything that matters at a glance.">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                    <Stat
                      label="Posts"
                      value={m.live.length}
                      sub={`${m.posts7} this week · ${m.posts30} this month`}
                    />
                    <Stat
                      label="Members"
                      value={data.users.length}
                      sub={`${m.activeSince30} active in 30 days`}
                    />
                    <Stat
                      label="Likes"
                      value={m.totalLikes}
                      sub={`${(m.totalLikes / Math.max(m.live.length, 1)).toFixed(1)} avg per post`}
                      tone="heart"
                    />
                    <Stat
                      label="Comments"
                      value={data.comments.length}
                      sub={`${m.comments30} this month`}
                    />
                    <Stat label="Engagement" value={engagement} sub="likes + comments per post" />
                    <Stat
                      label="Site streak"
                      value={m.siteStreaks.current ? `${m.siteStreaks.current}d` : "0"}
                      sub={`best ever: ${m.siteStreaks.longest} days straight`}
                      tone={m.siteStreaks.current ? "green" : undefined}
                    />
                    <Stat
                      label="Last post"
                      value={
                        m.daysSinceLastPost === null
                          ? "—"
                          : m.daysSinceLastPost === 0
                            ? "Today"
                            : `${m.daysSinceLastPost}d ago`
                      }
                      sub={fmtDate(m.live[0]?.timestamp ?? null)}
                      tone={
                        m.daysSinceLastPost !== null && m.daysSinceLastPost > 2 ? "gold" : undefined
                      }
                    />
                    <Stat
                      label="Push devices"
                      value={data.subs.length}
                      sub={`${subsByUid.size} member${subsByUid.size === 1 ? "" : "s"} enabled`}
                    />
                  </div>
                </Section>

                <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
                  <Section
                    title="Growth"
                    desc="Every post ever shared, added up month by month."
                  >
                    <AreaChart data={m.postsGrowth} tone="255,59,92" />
                  </Section>
                  <Section title="At a glance">
                    <Facts
                      rows={[
                        ["Lurkers (0 posts & comments)", m.lurkers.length],
                        ["Posts with a caption", pct(m.captioned.length, m.live.length)],
                        ["Comments per post", (data.comments.length / Math.max(m.live.length, 1)).toFixed(1)],
                        [
                          "Busiest day",
                          m.perDay[0]
                            ? `${m.perDay[0][1]} on ${fmtDate(new Date(m.perDay[0][0]))}`
                            : "—",
                        ],
                        ["First post", fmtDate(m.live.at(-1)?.timestamp ?? null)],
                        ["Anonymous-era posts", m.anonPosts],
                        [
                          "Portrait photos",
                          m.withDims
                            ? `${Math.round((m.aspect.portrait / m.withDims) * 100)}%`
                            : "—",
                        ],
                      ]}
                    />
                  </Section>
                </div>

                <Section
                  title="Activity heatmap"
                  desc="Posts and comments per day over the last six months."
                >
                  <Heatmap counts={m.heatCounts} />
                </Section>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Section title="Latest posts" flush>
                    {m.live.slice(0, 6).map((p) => (
                      <Row
                        key={p.id}
                        lead={
                          p.imagePath ? (
                            <Thumb path={p.imagePath} />
                          ) : (
                            <div className="h-11 w-11 shrink-0 rounded-lg bg-field" />
                          )
                        }
                        title={
                          <span className="block truncate">
                            <span className="font-semibold">{p.username || "Anonymous"}</span>
                            {p.caption && <span className="text-body"> — {p.caption}</span>}
                          </span>
                        }
                        meta={
                          <>
                            {fmtDateTime(p.timestamp)} · ♥ {p.likedBy.length} · 💬{" "}
                            {m.commentsByPost.get(p.id) ?? 0}
                          </>
                        }
                        actions={
                          <Link href={`/p/${p.id}`} target="_blank" className={btn}>
                            Open
                          </Link>
                        }
                      />
                    ))}
                    {m.live.length === 0 && (
                      <div className="p-4">
                        <Empty>No posts yet.</Empty>
                      </div>
                    )}
                  </Section>
                  <Section
                    title="Recent admin activity"
                    right={
                      <button onClick={() => setTab("system")} className={btn}>
                        Full log
                      </button>
                    }
                    flush
                  >
                    {data.log.slice(0, 6).map((entry) => (
                      <Row
                        key={entry.id}
                        align="start"
                        title={
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="rounded border-[0.5px] border-edge bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-body">
                              {entry.action}
                            </span>
                            <span className="min-w-0 truncate text-mut">{entry.detail}</span>
                          </span>
                        }
                        meta={fmtDateTime(entry.at)}
                      />
                    ))}
                    {data.log.length === 0 && (
                      <div className="p-4">
                        <Empty>No admin actions recorded yet.</Empty>
                      </div>
                    )}
                  </Section>
                </div>
              </>
            )}

            {/* ------------------------------- analytics ------------------------------- */}
            {tab === "analytics" && (
              <>
                <div className="grid items-start gap-4 xl:grid-cols-2">
                  <Section title="Posts per month">
                    <BarChart data={m.postsMonthly} />
                  </Section>
                  <Section title="All-time posts (cumulative)">
                    <AreaChart data={m.postsGrowth} />
                  </Section>
                  <Section title="Comments per month">
                    <BarChart data={m.commentsMonthly} />
                  </Section>
                  <Section title="Active members per month">
                    <BarChart data={m.activeMonthly} />
                  </Section>
                  <Section title="Posting activity — hour of day">
                    <BarChart data={m.hourHist} />
                  </Section>
                  <Section title="Posting activity — day of week">
                    <BarChart data={m.weekdayHist} />
                  </Section>
                  <Section
                    title="Image orientation"
                    desc="Aspect ratio of posts with known dimensions."
                  >
                    <StackBar
                      segments={[
                        { label: "Portrait", v: m.aspect.portrait },
                        { label: "Landscape", v: m.aspect.landscape },
                        { label: "Square", v: m.aspect.square },
                      ]}
                    />
                  </Section>
                </div>

                <Section title="Content analytics" desc="What everyone actually writes about.">
                  <div className="grid gap-2.5 lg:grid-cols-3">
                    <Board title="Top words (captions + comments)" rows={m.words} />
                    <Board title="Top emoji" rows={m.emoji} />
                    <div className="rounded-xl border-[0.5px] border-field bg-card p-3.5">
                      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[1.5px] text-mut">
                        Writing habits
                      </p>
                      <Facts
                        rows={[
                          ["Avg comment length", `${m.avgCommentLen} chars`],
                          ["Posts with captions", pct(m.captioned.length, m.live.length)],
                          [
                            "Posts before 6 AM",
                            m.live.filter((p) => p.timestamp!.getHours() < 6).length,
                          ],
                          [
                            "Avg caption length",
                            `${Math.round(
                              m.captioned.reduce((n, p) => n + (p.caption?.length ?? 0), 0) /
                                Math.max(m.captioned.length, 1)
                            )} chars`,
                          ],
                        ]}
                      />
                    </div>
                  </div>
                </Section>
              </>
            )}

            {/* ----------------------------- leaderboards ------------------------------ */}
            {tab === "leaderboards" && (
              <>
                <Section title="People" desc="Top eight in each race, all time.">
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    <Board title="Top posters" rows={m.topPosters} />
                    <Board title="Top commenters" rows={m.topCommenters} />
                    <Board title="Most likes given" rows={m.likesGiven} />
                    <Board title="Most likes received" rows={m.likesReceived} />
                    <Board title="Longest posting streaks" rows={m.userStreaks} />
                    <Board title="Night owls (posts before 6 AM)" rows={m.nightOwls} />
                  </div>
                </Section>
                <Section title="Posts">
                  <div className="grid gap-2.5 xl:grid-cols-2">
                    <Board
                      title="Most liked posts"
                      rows={m.topLiked.map((p) => [
                        `${p.username || "Anonymous"}${p.caption ? ` — “${p.caption.slice(0, 32)}”` : ""}`,
                        `♥ ${p.likedBy.length}`,
                      ])}
                    />
                    <Board
                      title="Most commented posts"
                      rows={m.topCommented.map((p) => [
                        `${p.username || "Anonymous"}${p.caption ? ` — “${p.caption.slice(0, 32)}”` : ""}`,
                        `💬 ${m.commentsByPost.get(p.id) ?? 0}`,
                      ])}
                    />
                  </div>
                </Section>
              </>
            )}

            {/* -------------------------------- members -------------------------------- */}
            {tab === "members" && (
              <>
                <AccessPanel
                  usernames={new Map(data.users.map((u) => [u.uid ?? "", u.username]))}
                  onLog={log}
                />
                <Section
                  title="Members"
                  count={data.users.length}
                  right={
                    <button onClick={exportMembersCsv} className={btn}>
                      <AdminIcon name="download" className="h-3.5 w-3.5" />
                      CSV
                    </button>
                  }
                  flush
                >
                  <div className="flex flex-col gap-2 border-b-[0.5px] border-field px-4 py-3 sm:flex-row sm:items-center">
                    <SearchInput
                      value={mSearch}
                      onChange={setMSearch}
                      placeholder="Search name or email…"
                    />
                    <select
                      value={mSort}
                      onChange={(e) => setMSort(e.target.value as typeof mSort)}
                      className={selectCls}
                      aria-label="Sort members"
                    >
                      <option value="posts">Most posts</option>
                      <option value="comments">Most comments</option>
                      <option value="likes">Most likes received</option>
                      <option value="active">Recently active</option>
                      <option value="joined">Newest members</option>
                      <option value="name">Name A–Z</option>
                    </select>
                  </div>
                  {memberRows.length === 0 ? (
                    <div className="p-4">
                      <Empty>No members match “{mSearch}”.</Empty>
                    </div>
                  ) : (
                    <>
                    <div className="sm:hidden">
                      {memberRows.map(({ u, posts, comments, likes, last }) => {
                        const open = openMember === u.email;
                        return (
                          <div
                            key={u.email}
                            className="border-b-[0.5px] border-field px-4 py-3 last:border-b-0"
                          >
                            <div className="flex items-center gap-2.5">
                              {memberAvatar(u)}
                              <span className="min-w-0 flex-1">
                                {memberName(u)}
                                <span className="block truncate text-[10.5px] text-dim">
                                  {u.email}
                                </span>
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dim">
                              <span>
                                <span className="font-bold tabular-nums text-white">{posts}</span>{" "}
                                posts
                              </span>
                              <span>
                                <span className="font-bold tabular-nums text-white">{comments}</span>{" "}
                                comments
                              </span>
                              <span>
                                <span className="font-bold tabular-nums text-white">{likes}</span> ♥
                                received
                              </span>
                              <span>joined {fmtDate(u.joinedAt)}</span>
                              <span>active {fmtDate(last)}</span>
                            </div>
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {memberActions(u, open)}
                            </div>
                            {open && (
                              <div className="mt-2.5">
                                <MemberDetail
                                  u={u}
                                  data={data}
                                  live={m.live}
                                  nameOf={m.nameOf}
                                  onDeletePost={adminDeletePost}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="hidden sm:block">
                    <Table
                      minWidth={760}
                      head={
                        <>
                          <th className="py-2.5 pl-4 pr-3 font-bold">Member</th>
                          <th className="py-2.5 pr-3 font-bold">Joined</th>
                          <th className="py-2.5 pr-3 font-bold">Last active</th>
                          <th className="py-2.5 pr-3 text-right font-bold">Posts</th>
                          <th className="py-2.5 pr-3 text-right font-bold">Comments</th>
                          <th className="py-2.5 pr-3 text-right font-bold">♥ Recv</th>
                          <th className="py-2.5 pr-4"></th>
                        </>
                      }
                    >
                      {memberRows.map(({ u, posts, comments, likes, last }) => {
                        const open = openMember === u.email;
                        return (
                          <Fragment key={u.email}>
                            <tr
                              className={`border-b-[0.5px] border-field transition-colors hover:bg-white/[0.02] ${
                                open ? "bg-white/[0.03]" : ""
                              }`}
                            >
                              <td className="py-2.5 pl-4 pr-3">
                                <div className="flex items-center gap-2.5">
                                  {memberAvatar(u)}
                                  <span className="min-w-0">
                                    {memberName(u)}
                                    <span className="block truncate text-[10.5px] text-dim">
                                      {u.email}
                                    </span>
                                  </span>
                                </div>
                              </td>
                              <td className="whitespace-nowrap py-2.5 pr-3 text-mut">
                                {fmtDate(u.joinedAt)}
                              </td>
                              <td className="whitespace-nowrap py-2.5 pr-3 text-mut">
                                {fmtDate(last)}
                              </td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{posts}</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{comments}</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{likes}</td>
                              <td className="py-2.5 pr-4 text-right">
                                <div className="flex justify-end gap-1.5">{memberActions(u, open)}</div>
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b-[0.5px] border-field bg-white/[0.02]">
                                <td colSpan={7} className="px-4 pb-4 pt-1">
                                  <MemberDetail
                                    u={u}
                                    data={data}
                                    live={m.live}
                                    nameOf={m.nameOf}
                                    onDeletePost={adminDeletePost}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Table>
                    </div>
                    </>
                  )}
                  <p className="border-t-[0.5px] border-field px-4 py-3 text-[10.5px] leading-relaxed text-dim">
                    Muting is enforced by the server — a muted member can still browse and like, but
                    can&apos;t write posts or comments. Logins, invites and password resets are
                    managed above.
                  </p>
                </Section>

                <Section
                  title="Blocks"
                  count={m.blockEdges.length}
                  desc="Who has blocked who. Blocking is mutual invisibility — neither side sees the other's posts, profile, comments, notifications or DMs — and every check that enforces it, on the server and in the app, matches on the uids below and nothing else."
                  flush
                >
                  <div className="grid grid-cols-2 gap-2.5 border-b-[0.5px] border-field p-4 sm:grid-cols-4">
                    <Stat
                      label="Blocks"
                      value={m.blockEdges.length}
                      sub="one per direction"
                    />
                    <Stat
                      label="Mutual"
                      value={m.mutualBlocks}
                      sub="both blocked each other"
                    />
                    <Stat
                      label="Lists"
                      value={data.blocks.length}
                      sub="members who ever blocked"
                    />
                    <Stat
                      label="Not matching"
                      value={m.brokenBlocks.length}
                      sub="aimed at a uid nobody acts under"
                      tone={m.brokenBlocks.length ? "red" : undefined}
                    />
                  </div>
                  {m.blockEdges.length === 0 ? (
                    <div className="p-4">
                      <Empty>Nobody has blocked anyone.</Empty>
                    </div>
                  ) : (
                    m.blockEdges.map((e) => (
                      <Row
                        key={`${e.from.uid}>${e.to.uid}`}
                        align="start"
                        title={
                          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                            <span className="font-semibold">
                              {e.from.name ?? "Unknown member"}
                            </span>
                            <span className="text-dim">blocked</span>
                            <span className="font-semibold">{e.to.name ?? "Unknown member"}</span>
                            {e.mutual && <Pill tone="white">Both ways</Pill>}
                            {e.problem && <Pill tone="bad">Not matching</Pill>}
                          </span>
                        }
                        meta={
                          <>
                            <span className="flex flex-wrap items-center gap-1.5">
                              {uidChip(e.from.uid)}
                              <span>blocked</span>
                              {uidChip(e.to.uid)}
                            </span>
                            <span className="mt-1 block">
                              That uid has {e.to.posts} post{e.to.posts === 1 ? "" : "s"} ·{" "}
                              {e.to.devices} push device{e.to.devices === 1 ? "" : "s"}
                              {e.to.email ? ` · ${e.to.email}` : ""}
                              {e.to.lastPost ? ` · last posted ${fmtDate(e.to.lastPost)}` : ""}
                            </span>
                            {e.problem && (
                              <span className="mt-1 block text-bad">
                                {e.problem}
                                {e.liveTwin && (
                                  <>
                                    {" "}
                                    They post as {uidChip(e.liveTwin)} — that&apos;s the uid a
                                    block has to name.
                                  </>
                                )}
                              </span>
                            )}
                          </>
                        }
                        actions={
                          e.to.name ? (
                            <Link href={`/u/${e.to.uid}`} target="_blank" className={btn}>
                              Profile
                            </Link>
                          ) : undefined
                        }
                      />
                    ))
                  )}
                  <p className="border-t-[0.5px] border-field px-4 py-3 text-[10.5px] leading-relaxed text-dim">
                    Read-only. A block list belongs to the member who made it — the server lets
                    only its owner change it, and unblocking on someone&apos;s behalf isn&apos;t the
                    admin&apos;s call. A row marked <b className="text-bad">not matching</b> is the
                    failure worth acting on: the person who set it believes they&apos;re invisible
                    to someone who still sees everything, and the uid it names is the reason.
                  </p>
                </Section>

                <Section
                  title="Member feedback"
                  count={data.feedback.length}
                  desc="Notes members send from Settings. Everything also lands in the admins chat, where it can be answered."
                  flush
                >
                  {data.feedback.length === 0 ? (
                    <div className="p-4">
                      <Empty>Nothing yet — notes members send from Settings land here, and in the admins chat.</Empty>
                    </div>
                  ) : (
                    data.feedback.map((f) => (
                      <Row
                        key={f.id}
                        align="start"
                        title={
                          <span className="flex flex-wrap items-center gap-x-1.5">
                            <span className="font-semibold">{f.username}</span>
                            <span className="text-dim">{f.email}</span>
                          </span>
                        }
                        meta={
                          <>
                            <span className="mb-1 block whitespace-pre-wrap text-[12.5px] leading-relaxed text-body">
                              {f.text}
                            </span>
                            {fmtDateTime(f.at)}
                          </>
                        }
                        actions={
                          <button onClick={() => adminDeleteFeedback(f.id)} className={btnDanger}>
                            Remove
                          </button>
                        }
                      />
                    ))
                  )}
                </Section>
              </>
            )}

            {/* ------------------------------ moderation ------------------------------- */}
            {tab === "moderation" && (
              <>
                <Segmented
                  value={modView}
                  onChange={setModView}
                  options={[
                    { id: "posts", label: "Posts", count: m.live.length },
                    { id: "trash", label: "Deleted", count: m.trashed.length },
                    { id: "comments", label: "Comments", count: data.comments.length },
                  ]}
                />

                {modView === "posts" && (
                  <Section
                    title="Posts"
                    count={m.live.length}
                    right={
                      <button onClick={exportPostsCsv} className={btn}>
                        <AdminIcon name="download" className="h-3.5 w-3.5" />
                        CSV
                      </button>
                    }
                    flush
                  >
                    <div className="flex flex-col gap-2 border-b-[0.5px] border-field px-4 py-3 sm:flex-row sm:items-center">
                      <SearchInput
                        value={search}
                        onChange={(v) => {
                          setSearch(v);
                          setPage(0);
                        }}
                        placeholder="Search caption or member…"
                      />
                      <select
                        value={sort}
                        onChange={(e) => {
                          setSort(e.target.value as typeof sort);
                          setPage(0);
                        }}
                        className={selectCls}
                        aria-label="Sort posts"
                      >
                        <option value="new">Newest</option>
                        <option value="liked">Most liked</option>
                        <option value="commented">Most commented</option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-b-[0.5px] border-field px-4 py-2.5">
                      <button
                        onClick={() =>
                          setSelected((s) => {
                            const next = new Set(s);
                            const allSelected = pagePosts.every((p) => next.has(p.id));
                            for (const p of pagePosts) {
                              if (allSelected) next.delete(p.id);
                              else next.add(p.id);
                            }
                            return next;
                          })
                        }
                        className={btn}
                      >
                        {pagePosts.every((p) => selected.has(p.id)) && pagePosts.length
                          ? "Unselect page"
                          : "Select page"}
                      </button>
                      {selected.size > 0 ? (
                        <>
                          <span className="text-[11px] tabular-nums text-mut">
                            {selected.size} selected
                          </span>
                          <span className="ml-auto flex gap-2">
                            <button onClick={bulkDeletePosts} className={btnDanger}>
                              Delete selected
                            </button>
                            <button onClick={() => setSelected(new Set())} className={btn}>
                              Clear
                            </button>
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-dim">
                          {sortedPosts.length.toLocaleString()} matching post
                          {sortedPosts.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>

                    {pagePosts.length === 0 ? (
                      <div className="p-4">
                        <Empty>No posts match that search.</Empty>
                      </div>
                    ) : (
                      pagePosts.map((p) => (
                        <Row
                          key={p.id}
                          lead={
                            <>
                              <Checkbox
                                label="Select post"
                                checked={selected.has(p.id)}
                                onChange={(on) =>
                                  setSelected((s) => {
                                    const next = new Set(s);
                                    if (on) next.add(p.id);
                                    else next.delete(p.id);
                                    return next;
                                  })
                                }
                              />
                              {p.imagePath ? (
                                <Thumb path={p.imagePath} />
                              ) : (
                                <div className="h-11 w-11 shrink-0 rounded-lg bg-field" />
                              )}
                            </>
                          }
                          title={
                            <span className="block truncate">
                              <span className="font-semibold">{p.username || "Anonymous"}</span>
                              {p.caption && <span className="text-body"> — {p.caption}</span>}
                            </span>
                          }
                          meta={
                            <>
                              {fmtDateTime(p.timestamp)} · ♥ {p.likedBy.length} · 💬{" "}
                              {m.commentsByPost.get(p.id) ?? 0}
                              {!p.imageWidth && " · no dims"}
                            </>
                          }
                          actions={postRowActions(p)}
                        />
                      ))
                    )}
                    <Pagination
                      page={postPage}
                      perPage={PER_PAGE}
                      total={sortedPosts.length}
                      onPage={setPage}
                    />
                  </Section>
                )}

                {modView === "trash" && (
                  <Section
                    title="Deleted posts"
                    count={m.trashed.length}
                    desc="Posts members removed from Settings (or an admin archived). Hidden everywhere in the app but never destroyed — Recover puts one back in the feed exactly as it was; Delete forever actually erases it."
                    flush
                  >
                    {m.trashed.length === 0 ? (
                      <div className="p-4">
                        <Empty>Trash is empty.</Empty>
                      </div>
                    ) : (
                      m.trashed.map((p) => (
                        <Row
                          key={p.id}
                          lead={
                            p.imagePath ? (
                              <Thumb path={p.imagePath} />
                            ) : (
                              <div className="h-11 w-11 shrink-0 rounded-lg bg-field" />
                            )
                          }
                          title={
                            <span className="block truncate">
                              <span className="font-semibold">{p.username || "Anonymous"}</span>
                              {p.caption && <span className="text-body"> — {p.caption}</span>}
                            </span>
                          }
                          meta={
                            <>
                              posted {fmtDateTime(p.timestamp)} · deleted{" "}
                              {fmtDateTime(p.deletedAt ?? null)} · ♥ {p.likedBy.length}
                            </>
                          }
                          actions={
                            <>
                              <button onClick={() => adminRecoverPost(p)} className={btn}>
                                Recover
                              </button>
                              <button onClick={() => adminDeletePost(p)} className={btnDanger}>
                                Delete forever
                              </button>
                            </>
                          }
                        />
                      ))
                    )}
                  </Section>
                )}

                {modView === "comments" && (
                  <Section title="Comments" count={data.comments.length} flush>
                    <div className="flex flex-col gap-2 border-b-[0.5px] border-field px-4 py-3 sm:flex-row sm:items-center">
                      <SearchInput
                        value={cSearch}
                        onChange={(v) => {
                          setCSearch(v);
                          setCPage(0);
                        }}
                        placeholder="Search comment text or member…"
                      />
                    </div>
                    {pageComments.length === 0 ? (
                      <div className="p-4">
                        <Empty>No comments match that search.</Empty>
                      </div>
                    ) : (
                      pageComments.map((c) => (
                        <Row
                          key={`${c.postId}-${c.id}`}
                          title={
                            <span className="block truncate">
                              <span className="font-semibold">{c.username}</span>{" "}
                              <span className="text-body">{c.text}</span>
                            </span>
                          }
                          meta={fmtDateTime(c.timestamp)}
                          actions={
                            <>
                              <span className="hidden sm:block">
                                <Link href={`/p/${c.postId}`} target="_blank" className={btn}>
                                  Open
                                </Link>
                              </span>
                              <button onClick={() => adminDeleteComment(c)} className={btnDanger}>
                                Delete
                              </button>
                            </>
                          }
                        />
                      ))
                    )}
                    <Pagination
                      page={commentPage}
                      perPage={C_PER_PAGE}
                      total={filteredComments.length}
                      onPage={setCPage}
                    />
                  </Section>
                )}
              </>
            )}

            {/* ------------------------------- broadcast ------------------------------- */}
            {tab === "broadcast" && (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <BroadcastComposer
                  deviceCount={data.subs.length}
                  onSent={(message, result, test) => {
                    if (!test) log("broadcast-push", `“${message.slice(0, 100)}” — ${result}`);
                  }}
                />
                <AnnouncementManager
                  key={loadEpoch}
                  initial={data.announcement}
                  onSave={saveAnnouncement}
                />
              </div>
            )}

            {/* --------------------------------- system -------------------------------- */}
            {tab === "system" && (
              <>
                <SecurityPanel user={user} unlockedAt={unlockedAt} onLock={lock} />

                <DeletedFilesSetting
                  onChange={(keep) => log(keep ? "keep-deleted-photos" : "erase-deleted-photos", "")}
                />

                <Section
                  title="Data health"
                  desc="Rows the app can't show and records it can't resolve. Sweeping is permanent."
                  right={
                    <>
                      {m.dead.length > 0 && (
                        <button onClick={sweepDeadDocs} className={btnDanger}>
                          Delete {m.dead.length} dead docs
                        </button>
                      )}
                      {m.orphanComments.length > 0 && (
                        <button onClick={sweepOrphanComments} className={btnDanger}>
                          Delete {m.orphanComments.length} orphans
                        </button>
                      )}
                    </>
                  }
                >
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                    <Stat
                      label="Dead photo docs"
                      value={m.dead.length}
                      sub="no timestamp/image — never render"
                      tone={m.dead.length ? "red" : undefined}
                    />
                    <Stat
                      label="Orphaned comments"
                      value={m.orphanComments.length}
                      sub="parent post deleted"
                      tone={m.orphanComments.length ? "red" : undefined}
                    />
                    <Stat
                      label="Posts w/o dims"
                      value={m.noDims}
                      sub="feed can't reserve space"
                      tone={m.noDims ? "gold" : undefined}
                    />
                    <Stat
                      label="Ghost likes"
                      value={m.ghostLikes}
                      sub="from uids with no known name"
                    />
                    <Stat label="Total photo docs" value={data.photos.length} />
                    <Stat label="Total comment docs" value={data.comments.length} />
                    <Stat label="Muted members" value={mutedCount} />
                  </div>
                </Section>

                <Section
                  title="Push devices"
                  count={data.subs.length}
                  desc={`${subsByUid.size} member${subsByUid.size === 1 ? "" : "s"} with notifications enabled.`}
                  flush
                >
                  {data.subs.length === 0 ? (
                    <div className="p-4">
                      <Empty>No devices enabled yet.</Empty>
                    </div>
                  ) : (
                    [...subsByUid.entries()].map(([uid, subs]) =>
                      subs.map((s, i) => (
                        <Row
                          key={s.id}
                          title={
                            <span className="block truncate">
                              <span className="font-semibold">
                                {m.nameOf(uid === "unknown" ? null : uid)}
                              </span>
                              <span className="ml-1.5 text-dim">device {i + 1}</span>
                            </span>
                          }
                          meta={
                            <>
                              {endpointHost(s.endpoint)} · updated {fmtDate(s.updatedAt)}
                            </>
                          }
                          actions={
                            <button onClick={() => adminDeleteSub(s)} className={btnDanger}>
                              Remove
                            </button>
                          }
                        />
                      ))
                    )
                  )}
                </Section>

                <Section
                  title="Audit log"
                  count={data.log.length}
                  desc="Append-only. Every delete, rename, mute, broadcast and announcement lands here — it can't be edited or cleared, even by you."
                  flush
                >
                  {data.log.length === 0 ? (
                    <div className="p-4">
                      <Empty>No admin actions recorded yet.</Empty>
                    </div>
                  ) : (
                    data.log.slice(0, 100).map((entry) => (
                      <Row
                        key={entry.id}
                        align="start"
                        title={
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="rounded border-[0.5px] border-edge bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-body">
                              {entry.action}
                            </span>
                            <span className="min-w-0 break-words text-mut">{entry.detail}</span>
                          </span>
                        }
                        meta={fmtDateTime(entry.at)}
                      />
                    ))
                  )}
                  {data.log.length > 100 && (
                    <p className="border-t-[0.5px] border-field px-4 py-3 text-[10.5px] text-dim">
                      Showing the 100 most recent of {data.log.length} entries.
                    </p>
                  )}
                </Section>

                <p className="px-1 text-[10.5px] leading-relaxed text-dim">
                  Access is enforced by the server, not just this page: only admin accounts can
                  read this data, and admin changes (deletes, renames, mutes, announcements) are
                  rejected unless your password was re-entered in the last 15 minutes.
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
