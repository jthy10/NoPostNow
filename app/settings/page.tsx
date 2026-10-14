"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useBlockSets, unblockUser } from "@/lib/blocks";
import { fetchMessageableUsers } from "@/lib/users";
import {
  MAX_FEEDBACK_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  changeEmail,
  changePassword,
  deleteMyAccount,
  isUsernameTaken,
  renameUser,
  sendFeedback,
  softDeleteAllMyPosts,
  validateUsername,
} from "@/lib/settings";
import {
  DEFAULT_PREFS,
  loadNotifPrefs,
  saveNotifPrefs,
  type NotifPrefs,
} from "@/lib/notif-prefs";
import { formatMinutes } from "@/lib/quiet-hours";
import { downloadExport } from "@/lib/export";
import {
  MASCOT_DETAILS,
  MASCOTS,
  saveMascotPreference,
  useMascotPreference,
  type MascotKind,
} from "@/lib/mascot";
import { ensurePushSubscription, isStandalone, pushSupported, requestPushPermission } from "@/lib/push";
import Avatar from "@/components/Avatar";
import { MascotPreview } from "@/components/Mascot";
import PageHeader from "@/components/PageHeader";
import ViewportShell from "@/components/ViewportShell";
import { useSite } from "@/components/SiteProvider";
import { dailyMomentLabel, dailyMomentTime } from "@/lib/site";

// Settings, iOS-grouped-list style: titled card groups of rows. Tapping a
// row with a form expands it in place (one open at a time); switches save
// instantly. Red lives at the bottom, where it belongs.

const inputCls =
  "w-full rounded-lg border-[0.5px] border-edge bg-field px-3.5 py-3 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-mut";
const btnCls =
  "rounded-lg bg-white px-5 py-2.5 text-xs font-extrabold text-black transition-opacity disabled:opacity-30";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "invalid-credential") return "Current password is wrong.";
    if (e.code === "permission-denied") return "You don't have permission to do that.";
    if (e.status === 0) return "Couldn't reach the server — check your connection.";
    if (e.message && e.message !== e.code) return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

type Msg = { ok: boolean; text: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`mt-2.5 text-xs leading-relaxed ${msg.ok ? "text-[#2ecc71]" : "text-heart"}`}>
      {msg.text}
    </p>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-6">
      <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-[1.5px] text-mut">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border-[0.5px] border-edge bg-card">
        {children}
      </div>
    </section>
  );
}

const rowDivide = "border-t-[0.5px] border-field first:border-t-0";

// A tappable row that expands its form in place.
function Row({
  label,
  sub,
  open,
  onToggle,
  danger,
  children,
}: {
  label: string;
  sub?: ReactNode;
  open: boolean;
  onToggle: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={rowDivide}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-field"
      >
        <div className="min-w-0 flex-1">
          <p className={`text-[14px] font-bold ${danger ? "text-[#e74c3c]" : ""}`}>{label}</p>
          {sub && <p className="mt-0.5 truncate text-[12px] text-mut">{sub}</p>}
        </div>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-dim transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ToggleRow({
  label,
  sub,
  on,
  disabled,
  onChange,
}: {
  label: ReactNode;
  sub?: ReactNode;
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${rowDivide}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold">{label}</p>
        {sub && <p className="mt-0.5 text-[12px] leading-snug text-mut">{sub}</p>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-[28px] w-[48px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 ${
          on ? "bg-[#30d158]" : "bg-edge"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-all duration-200 ${
            on ? "left-[22px]" : "left-[2px]"
          }`}
        />
      </button>
    </div>
  );
}

// "HH:MM" <-> minutes-since-midnight for <input type="time">.
const toTime = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const fromTime = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export default function SettingsPage() {
  const { user, username, loading, setUsername, adopt, refresh } = useAuth();
  const router = useRouter();
  const site = useSite();

  // Which expandable row is open — one at a time keeps the page tidy.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const toggleRow = (key: string) => {
    setOpenRow((o) => (o === key ? null : key));
  };

  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<Msg>(null);

  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<Msg>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<Msg>(null);

  const [feedback, setFeedback] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbMsg, setFbMsg] = useState<Msg>(null);

  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState<Msg>(null);

  const [acctPw, setAcctPw] = useState("");
  const [acctPhrase, setAcctPhrase] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctMsg, setAcctMsg] = useState<Msg>(null);

  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<Msg>(null);

  // Notification prefs: loaded once, saved optimistically on every change.
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [prefsMsg, setPrefsMsg] = useState<Msg>(null);
  const [pushHint, setPushHint] = useState<string | null>(null);

  const mascot = useMascotPreference(user?.uid);
  const [mascotBusy, setMascotBusy] = useState(false);
  const [mascotMsg, setMascotMsg] = useState<Msg>(null);

  const { blocked } = useBlockSets(user?.uid);
  const [blockNames, setBlockNames] = useState<Map<string, string>>(new Map());
  const [unblockBusy, setUnblockBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Seed the username field once auth resolves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from async auth state
    if (username) setName((n) => n || username);
  }, [username]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadNotifPrefs(user.uid)
      // Unreadable prefs (offline, stale rules) fall back to the defaults —
      // a save will surface any real error.
      .catch(() => ({ ...DEFAULT_PREFS }))
      .then((p) => {
        if (!cancelled) setPrefs(p);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Names for the blocked list — uid -> username via the session user cache.
  useEffect(() => {
    if (blocked.size === 0) return;
    let cancelled = false;
    fetchMessageableUsers().then((users) => {
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const u of users) if (u.uid) map.set(u.uid, u.username);
      setBlockNames(map);
    });
    return () => {
      cancelled = true;
    };
  }, [blocked]);

  if (loading || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  async function savePrefs(next: NotifPrefs) {
    if (!user) return;
    const prev = prefs;
    setPrefs(next);
    setPrefsMsg(null);
    try {
      await saveNotifPrefs(user.uid, next);
    } catch (e) {
      setPrefs(prev);
      setPrefsMsg({ ok: false, text: errorMessage(e) });
    }
  }

  async function chooseMascot(next: MascotKind) {
    if (!user?.email || next === mascot || mascotBusy) return;
    setMascotBusy(true);
    setMascotMsg(null);
    try {
      await saveMascotPreference(user.uid, next);
    } catch (e) {
      setMascotMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setMascotBusy(false);
    }
  }

  // Turning the daily call on should also make sure this device can
  // actually hear it — subscribe (or prompt) while we have the tap.
  async function setDailyCall(on: boolean) {
    if (!user || !prefs) return;
    setPushHint(null);
    await savePrefs({ ...prefs, daily: on });
    if (!on) return;
    if (!isStandalone() || !pushSupported()) {
      setPushHint(
        `Saved — but this device can't receive pushes. Install ${site.siteName} to your Home Screen and enable notifications to hear the daily call.`
      );
      return;
    }
    const outcome =
      Notification.permission === "granted"
        ? await ensurePushSubscription(user.uid)
        : await requestPushPermission(user.uid);
    if (!outcome.ok) {
      setPushHint(
        `Saved — but notifications aren't on for this device yet (${outcome.reason}).`
      );
    }
  }

  async function saveUsername() {
    if (!user?.email) return;
    const next = name.trim();
    if (next === username) return;
    const invalid = validateUsername(next);
    if (invalid) {
      setNameMsg({ ok: false, text: invalid });
      return;
    }
    setNameBusy(true);
    setNameMsg(null);
    try {
      if (await isUsernameTaken(next, user.uid)) {
        setNameMsg({ ok: false, text: `“${next}” is already taken.` });
        return;
      }
      await renameUser({ uid: user.uid, newName: next });
      setUsername(next);
      setNameMsg({ ok: true, text: "Saved — your old posts and comments now show the new name." });
    } catch (e) {
      setNameMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setNameBusy(false);
    }
  }

  async function saveEmail() {
    if (!user) return;
    const next = newEmail.trim().toLowerCase();
    if (!next || !emailPw) return;
    setEmailBusy(true);
    setEmailMsg(null);
    try {
      const saved = await changeEmail(emailPw, next);
      await refresh();
      setEmailMsg({ ok: true, text: `Done — you now sign in as ${saved}.` });
      setNewEmail("");
      setEmailPw("");
    } catch (e) {
      setEmailMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setEmailBusy(false);
    }
  }

  async function savePassword() {
    if (!user || !curPw || !newPw) return;
    if (newPw.length < MIN_PASSWORD_LENGTH) {
      setPwMsg({ ok: false, text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await changePassword(curPw, newPw);
      setCurPw("");
      setNewPw("");
      setPwMsg({ ok: true, text: "Password changed." });
    } catch (e) {
      setPwMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setPwBusy(false);
    }
  }

  async function submitFeedback() {
    if (!user?.email || !feedback.trim()) return;
    setFbBusy(true);
    setFbMsg(null);
    try {
      await sendFeedback({
        uid: user.uid,
        username: username || "Anonymous",
        text: feedback,
      });
      setFeedback("");
      setFbMsg({ ok: true, text: "Message received and delivered — thank you!" });
    } catch (e) {
      setFbMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setFbBusy(false);
    }
  }

  async function handleExport() {
    if (!user || exportBusy) return;
    setExportBusy(true);
    setExportMsg(null);
    try {
      await downloadExport(user);
      setExportMsg({ ok: true, text: "Downloaded — one JSON file with everything." });
    } catch (e) {
      setExportMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setExportBusy(false);
    }
  }

  async function deleteAllPosts() {
    if (!user) return;
    setDelBusy(true);
    setDelMsg(null);
    try {
      const { deleted, failed } = await softDeleteAllMyPosts(user.uid);
      setDelMsg(
        failed
          ? { ok: false, text: `Removed ${deleted}, but ${failed} failed — try again.` }
          : deleted
            ? { ok: true, text: `Done — ${deleted} post${deleted === 1 ? "" : "s"} removed from the feed.` }
            : { ok: true, text: "Nothing to remove — you have no posts up." }
      );
    } catch (e) {
      setDelMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setDelBusy(false);
    }
  }

  async function deleteAccount() {
    if (!user || acctBusy) return;
    if (acctPhrase.trim().toUpperCase() !== "DELETE") {
      setAcctMsg({ ok: false, text: "Type DELETE to confirm." });
      return;
    }
    if (!acctPw) {
      setAcctMsg({ ok: false, text: "Enter your password to confirm." });
      return;
    }
    setAcctBusy(true);
    setAcctMsg(null);
    try {
      await deleteMyAccount(acctPw);
      adopt({ user: null });
      router.replace("/login");
    } catch (e) {
      setAcctMsg({ ok: false, text: errorMessage(e) });
      setAcctBusy(false);
    }
  }

  async function handleUnblock(uid: string) {
    if (!user || unblockBusy) return;
    setUnblockBusy(uid);
    try {
      await unblockUser(user.uid, uid);
    } finally {
      setUnblockBusy(null);
    }
  }

  const quietOn = prefs !== null && prefs.quietStart !== null && prefs.quietEnd !== null;

  return (
    <ViewportShell>
      <PageHeader backHref="/profile" title="Settings" />

      <main className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-contain pb-12 pt-[calc(52px+env(safe-area-inset-top))]">
        <Group title="Account">
          <Row
            label="Username"
            sub={username || "—"}
            open={openRow === "username"}
            onToggle={() => toggleRow("username")}
          >
            <p className="mb-3 text-xs leading-relaxed text-mut">
              Your display name everywhere — must be unique. Changing it updates
              all your old posts and comments too.
            </p>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_USERNAME_LENGTH}
                placeholder="Username"
                className={inputCls}
              />
              <button
                onClick={saveUsername}
                disabled={nameBusy || !name.trim() || name.trim() === username}
                className={btnCls}
              >
                Save
              </button>
            </div>
            <Note msg={nameMsg} />
          </Row>

          <Row
            label="Email"
            sub={user.email}
            open={openRow === "email"}
            onToggle={() => toggleRow("email")}
          >
            <div className="flex flex-col gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email"
                autoComplete="email"
                className={inputCls}
              />
              <input
                type="password"
                value={emailPw}
                onChange={(e) => setEmailPw(e.target.value)}
                placeholder="Current password"
                autoComplete="current-password"
                className={inputCls}
              />
              <button
                onClick={saveEmail}
                disabled={emailBusy || !newEmail.trim() || !emailPw}
                className={`self-start ${btnCls}`}
              >
                Change email
              </button>
            </div>
            <Note msg={emailMsg} />
          </Row>

          <Row
            label="Password"
            sub="••••••••"
            open={openRow === "password"}
            onToggle={() => toggleRow("password")}
          >
            <div className="flex flex-col gap-2">
              <input
                type="password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                placeholder="Current password"
                autoComplete="current-password"
                className={inputCls}
              />
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
                autoComplete="new-password"
                className={inputCls}
              />
              <button
                onClick={savePassword}
                disabled={pwBusy || !curPw || !newPw}
                className={`self-start ${btnCls}`}
              >
                Change password
              </button>
            </div>
            <Note msg={pwMsg} />
          </Row>
        </Group>

        <Group title="Mascot">
          <div
            role="radiogroup"
            aria-label="Choose your navbar animal"
            className="grid grid-cols-2 gap-3 p-4"
          >
            {MASCOTS.map((animal) => {
              const selected = mascot === animal;
              const { label, motion } = MASCOT_DETAILS[animal];
              return (
                <button
                  key={animal}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={mascotBusy}
                  onClick={() => chooseMascot(animal)}
                  className={`mascot-choice relative flex min-h-[118px] flex-col items-center justify-center rounded-xl border px-3 py-4 transition-colors disabled:opacity-60 ${
                    selected
                      ? "border-white bg-white text-black"
                      : "border-edge bg-field text-white active:border-mut"
                  }`}
                >
                  <MascotPreview animal={animal} />
                  <span className="mt-2 text-[14px] font-extrabold">{label}</span>
                  <span className={`text-[11px] ${selected ? "text-black/55" : "text-mut"}`}>
                    {motion} on tap
                  </span>
                  {selected && (
                    <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-white">
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m3 8 3 3 7-7" />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="px-4 pb-4 text-[12px] leading-snug text-mut">
            Your pick sits beside the site name. Tap it in the navbar to send it across the screen.
          </p>
          {mascotMsg && (
            <div className="px-4 pb-4">
              <Note msg={mascotMsg} />
            </div>
          )}
        </Group>

        <Group title="Notifications">
          {prefs === null ? (
            <p className="px-4 py-4 text-[12px] text-dim">Loading…</p>
          ) : (
            <>
              {site.dailyMoment.enabled && (
                <>
                  <ToggleRow
                    label={
                      <span>
                        Daily {dailyMomentLabel()} call{" "}
                        <span className="ml-1 rounded-full bg-heart/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.5px] text-heart">
                          The ritual
                        </span>
                      </span>
                    }
                    sub={`Every day at exactly ${dailyMomentTime()}, a nudge to post what you're up to.`}
                    on={prefs.daily}
                    onChange={setDailyCall}
                  />
                  {pushHint && (
                    <p className="px-4 pb-3 text-[12px] leading-snug text-heart">{pushHint}</p>
                  )}
                </>
              )}
              <ToggleRow
                label="New posts"
                sub="When a friend posts a photo."
                on={prefs.posts}
                onChange={(on) => savePrefs({ ...prefs, posts: on })}
              />
              <ToggleRow
                label="Comments"
                sub="Comments on your posts and threads you're in."
                on={prefs.comments}
                onChange={(on) => savePrefs({ ...prefs, comments: on })}
              />
              <ToggleRow
                label="Likes"
                sub="When someone likes your photo."
                on={prefs.likes}
                onChange={(on) => savePrefs({ ...prefs, likes: on })}
              />
              <ToggleRow
                label="Messages"
                sub="Direct messages."
                on={prefs.dms}
                onChange={(on) => savePrefs({ ...prefs, dms: on })}
              />
              <ToggleRow
                label="Quiet hours"
                sub={
                  quietOn
                    ? `Silent ${formatMinutes(prefs.quietStart!)} – ${formatMinutes(prefs.quietEnd!)}`
                    : "Silence all pushes during set hours."
                }
                on={quietOn}
                onChange={(on) =>
                  savePrefs(
                    on
                      ? { ...prefs, quietStart: 22 * 60, quietEnd: 8 * 60 }
                      : { ...prefs, quietStart: null, quietEnd: null }
                  )
                }
              />
              {quietOn && (
                <div className="flex items-center gap-3 px-4 pb-4 pt-1">
                  <label className="flex flex-1 flex-col gap-1 text-[11px] font-bold uppercase tracking-[1px] text-mut">
                    From
                    <input
                      type="time"
                      value={toTime(prefs.quietStart!)}
                      onChange={(e) => {
                        const v = fromTime(e.target.value);
                        if (v !== null) savePrefs({ ...prefs, quietStart: v });
                      }}
                      className={inputCls}
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-[11px] font-bold uppercase tracking-[1px] text-mut">
                    Until
                    <input
                      type="time"
                      value={toTime(prefs.quietEnd!)}
                      onChange={(e) => {
                        const v = fromTime(e.target.value);
                        if (v !== null) savePrefs({ ...prefs, quietEnd: v });
                      }}
                      className={inputCls}
                    />
                  </label>
                </div>
              )}
              <p className="border-t-[0.5px] border-field px-4 py-3 text-[11px] leading-relaxed text-dim">
                These control push notifications on your devices. The bell inside
                the app always keeps the full history.
              </p>
              {prefsMsg && (
                <p className="px-4 pb-3 text-[12px] text-heart">{prefsMsg.text}</p>
              )}
            </>
          )}
        </Group>

        <Group title="Privacy">
          <Row
            label="Blocked users"
            sub={
              blocked.size === 0
                ? "You haven't blocked anyone."
                : `${blocked.size} blocked`
            }
            open={openRow === "blocked"}
            onToggle={() => toggleRow("blocked")}
          >
            <p className="mb-2 text-xs leading-relaxed text-mut">
              You and a blocked person don&apos;t see each other&apos;s posts,
              profiles, or activity. Unblocking restores everything.
            </p>
            {blocked.size === 0 ? (
              <p className="text-[13px] text-dim">Nobody on the list.</p>
            ) : (
              <div className="flex flex-col">
                {[...blocked].map((uid) => {
                  const bname = blockNames.get(uid) ?? "Someone";
                  return (
                    <div key={uid} className="flex items-center gap-3 py-2">
                      <Avatar username={bname} className="h-9 w-9 text-[11px]" />
                      <p className="min-w-0 flex-1 truncate text-[14px] font-bold">{bname}</p>
                      <button
                        onClick={() => handleUnblock(uid)}
                        disabled={unblockBusy === uid}
                        className="rounded-lg border-[0.5px] border-edge px-4 py-2 text-[11px] font-bold uppercase tracking-[1px] text-mut transition-colors hover:border-mut hover:text-white disabled:opacity-40"
                      >
                        {unblockBusy === uid ? "…" : "Unblock"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Row>
        </Group>

        <Group title="Your data">
          <div className={rowDivide}>
            <button
              onClick={handleExport}
              disabled={exportBusy}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-field disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold">
                  {exportBusy ? "Preparing your export…" : "Download my data"}
                </p>
                <p className="mt-0.5 text-[12px] text-mut">
                  Profile, posts, comments, likes, and messages as JSON.
                </p>
              </div>
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 text-dim"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            {exportMsg && (
              <p className={`px-4 pb-3 text-[12px] ${exportMsg.ok ? "text-[#2ecc71]" : "text-heart"}`}>
                {exportMsg.text}
              </p>
            )}
          </div>

          <Row
            label="Delete all my posts"
            sub="Removes your posts from the feed — recoverable by an admin."
            danger
            open={openRow === "delposts"}
            onToggle={() => toggleRow("delposts")}
          >
            <p className="mb-3 text-xs leading-relaxed text-mut">
              Removes every post you&apos;ve made from the feed. Nothing is
              destroyed — posts are archived and an admin can restore them if
              you change your mind.
            </p>
            <button
              onClick={deleteAllPosts}
              disabled={delBusy}
              className="rounded-lg bg-[#e74c3c] px-5 py-2.5 text-xs font-extrabold text-white transition-opacity disabled:opacity-40"
            >
              {delBusy ? "Removing…" : "Yes, remove everything"}
            </button>
            <Note msg={delMsg} />
          </Row>

          <Row
            label="Delete my account"
            sub="Permanently deletes your login and profile."
            danger
            open={openRow === "delacct"}
            onToggle={() => toggleRow("delacct")}
          >
            <p className="mb-3 text-xs leading-relaxed text-mut">
              This signs you out forever: your login, profile, notification
              settings, and push subscriptions are deleted, along with every
              post and photo you shared. Comments you left on friends&apos; posts
              and messages you sent stay. This cannot be undone — consider
              downloading your data first.
            </p>
            <div className="flex flex-col gap-2">
              <input
                type="password"
                value={acctPw}
                onChange={(e) => setAcctPw(e.target.value)}
                placeholder="Current password"
                autoComplete="current-password"
                className={inputCls}
              />
              <input
                value={acctPhrase}
                onChange={(e) => setAcctPhrase(e.target.value)}
                placeholder='Type "DELETE" to confirm'
                autoCapitalize="characters"
                autoComplete="off"
                className={inputCls}
              />
              <button
                onClick={deleteAccount}
                disabled={acctBusy || !acctPw || acctPhrase.trim().toUpperCase() !== "DELETE"}
                className="self-start rounded-lg bg-[#e74c3c] px-5 py-2.5 text-xs font-extrabold text-white transition-opacity disabled:opacity-40"
              >
                {acctBusy ? "Deleting…" : "Delete my account forever"}
              </button>
            </div>
            <Note msg={acctMsg} />
          </Row>
        </Group>

        <Group title="Support">
          <Row
            label="Note to the admins"
            sub="Ideas, bugs, complaints — straight to the people who run this site. Lands in your admins chat too, so you can keep the conversation going there."
            open={openRow === "feedback"}
            onToggle={() => toggleRow("feedback")}
          >
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              maxLength={MAX_FEEDBACK_LENGTH}
              rows={4}
              placeholder="What's on your mind…"
              className={`${inputCls} resize-none`}
            />
            <button
              onClick={submitFeedback}
              disabled={fbBusy || !feedback.trim()}
              className={`mt-2 ${btnCls}`}
            >
              Send
            </button>
            <Note msg={fbMsg} />
          </Row>
        </Group>

        <p className="px-5 pt-8 text-center text-[11px] tracking-[0.5px] text-dim">
          {site.siteName} — one feed, no algorithm.
        </p>
      </main>
    </ViewportShell>
  );
}
