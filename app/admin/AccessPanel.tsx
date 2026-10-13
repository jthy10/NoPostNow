"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Empty, Section, btn, btnDanger, btnPrimary, fmtDate, inputCls, selectCls } from "./shared";

// Who can get in, and what the site calls itself. Everything here is specific
// to running your own copy: invite links, password reset links (the site sends
// no email, so the host hands these out), admin roles, and the name, colour
// and daily moment chosen during setup.

type Account = {
  uid: string;
  email: string;
  role: "admin" | "member";
  disabled: boolean;
  totpEnabled: boolean;
  createdAt: number;
};

type Invite = { code: string; createdAt: number; expiresAt: number; maxUses: number; uses: number };

type SiteSettings = {
  siteName: string;
  tagline: string;
  accent: string;
  publicUrl: string;
  signup: "invite" | "open" | "closed";
  timeZone: string;
  dailyMoment: { enabled: boolean; time: string; bothHalves: boolean; specialDate: string };
  pushReady: boolean;
};

function message(e: unknown) {
  if (e instanceof ApiError && e.message && e.message !== e.code) return e.message;
  return e instanceof Error ? e.message : "Something went wrong.";
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const label = "mb-1 block text-[10px] font-bold uppercase tracking-[1.2px] text-dim";

export default function AccessPanel({
  usernames,
  onLog,
}: {
  // uid -> display name, from the profiles the console already loaded.
  usernames: Map<string, string>;
  onLog: (action: string, detail: string) => void;
}) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [origin, setOrigin] = useState("");
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // A freshly made link, shown until dismissed so it can be copied by hand.
  const [link, setLink] = useState<{ title: string; url: string } | null>(null);
  const [uses, setUses] = useState("1");
  const [days, setDays] = useState("7");
  // Read once per load, so rendering stays pure.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [a, i, s] = await Promise.all([
        apiGet<{ accounts: Account[] }>("/api/admin/accounts"),
        apiGet<{ invites: Invite[]; origin: string }>("/api/admin/invites"),
        apiGet<{ site: SiteSettings }>("/api/admin/site"),
      ]);
      setAccounts(a.accounts);
      setInvites(i.invites);
      setOrigin(i.origin);
      setSite(s.site);
      setNow(Date.now());
    } catch (e) {
      setNote({ ok: false, text: message(e) });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (a: Account) => usernames.get(a.uid) ?? a.email;

  function createInvite() {
    return run(async () => {
      const res = await apiPost<{ url: string }>("/api/admin/invite-create", {
        maxUses: Number(uses),
        days: Number(days),
      });
      setLink({ title: "Invite link", url: res.url });
      onLog("create-invite", `${uses} use(s), ${days} day(s)`);
      await load();
    });
  }

  function revoke(code: string) {
    return run(async () => {
      await apiPost("/api/admin/invite-revoke", { code });
      onLog("revoke-invite", code);
      await load();
    });
  }

  function resetLink(a: Account) {
    return run(async () => {
      const res = await apiPost<{ url: string }>("/api/admin/reset-link", { uid: a.uid });
      setLink({ title: `Password reset link for ${nameOf(a)} — valid 24 hours`, url: res.url });
      onLog("reset-link", nameOf(a));
    });
  }

  function setRole(a: Account, role: "admin" | "member") {
    if (!confirm(role === "admin" ? `Make ${nameOf(a)} an admin?` : `Remove admin from ${nameOf(a)}?`)) return;
    return run(async () => {
      await apiPost("/api/admin/set-role", { uid: a.uid, role });
      onLog("set-role", `${nameOf(a)} → ${role}`);
      await load();
    });
  }

  function setDisabled(a: Account, disabled: boolean) {
    if (disabled && !confirm(`Lock ${nameOf(a)} out? They are signed out everywhere until you re-enable them.`)) return;
    return run(async () => {
      await apiPost("/api/admin/set-disabled", { uid: a.uid, disabled });
      onLog(disabled ? "disable-member" : "enable-member", nameOf(a));
      await load();
    });
  }

  function remove(a: Account) {
    if (
      !confirm(
        `Remove ${nameOf(a)} for good?\n\nTheir login, profile, posts and photos are permanently deleted. This cannot be undone.`
      )
    )
      return;
    return run(async () => {
      await apiPost("/api/admin/remove-member", { uid: a.uid });
      onLog("remove-member", nameOf(a));
      await load();
    });
  }

  function saveSite() {
    if (!site) return;
    return run(async () => {
      const res = await apiPost<{ site: SiteSettings }>("/api/admin/site", { site });
      setSite(res.site);
      onLog("site-settings", res.site.siteName);
      setNote({ ok: true, text: "Saved. Reload the page to see the new name and colour." });
    });
  }

  const patch = (next: Partial<SiteSettings>) => setSite((s) => (s ? { ...s, ...next } : s));
  const patchMoment = (next: Partial<SiteSettings["dailyMoment"]>) =>
    setSite((s) => (s ? { ...s, dailyMoment: { ...s.dailyMoment, ...next } } : s));

  return (
    <>
      {note && (
        <p className={`px-1 text-[11.5px] ${note.ok ? "text-[#2ecc71]" : "text-heart"}`}>{note.text}</p>
      )}

      {link && (
        <div className="rounded-xl border-[0.5px] border-edge bg-card p-4">
          <p className="text-[11.5px] font-bold">{link.title}</p>
          <p className="mt-2 break-all font-mono text-[11px] text-mut">{link.url}</p>
          <div className="mt-3 flex gap-2">
            <button
              className={btnPrimary}
              onClick={async () =>
                setNote((await copy(link.url)) ? { ok: true, text: "Copied." } : { ok: false, text: "Copy it by hand." })
              }
            >
              Copy
            </button>
            <button className={btn} onClick={() => setLink(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <Section
        title="Invites"
        count={invites?.length}
        desc={
          site?.signup === "open"
            ? "Sign-ups are open, so anyone with the address can join without an invite."
            : site?.signup === "closed"
              ? "Sign-ups are closed. Invite links won't work until you allow them again below."
              : "People join with an invite link. Make one, send it to a friend, and they pick their own username and password."
        }
      >
        <div className="flex flex-wrap items-end gap-2.5 px-4 py-3.5">
          <label>
            <span className={label}>Uses</span>
            <select value={uses} onChange={(e) => setUses(e.target.value)} className={selectCls}>
              {["1", "5", "10", "25", "100"].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>Expires in</span>
            <select value={days} onChange={(e) => setDays(e.target.value)} className={selectCls}>
              {[
                ["1", "1 day"],
                ["7", "7 days"],
                ["30", "30 days"],
              ].map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <button onClick={createInvite} disabled={busy} className={btnPrimary}>
            Create invite link
          </button>
        </div>
        {invites === null ? null : invites.length === 0 ? (
          <Empty>No invites outstanding.</Empty>
        ) : (
          invites.map((i) => {
            const spent = i.uses >= i.maxUses || i.expiresAt < now;
            return (
              <div
                key={i.code}
                className="flex flex-wrap items-center gap-2.5 border-t-[0.5px] border-field px-4 py-2.5 text-[11.5px]"
              >
                <span className={`font-mono ${spent ? "text-dim line-through" : "text-body"}`}>{i.code}</span>
                <span className="text-dim">
                  {i.uses}/{i.maxUses} used · expires {fmtDate(new Date(i.expiresAt))}
                </span>
                <span className="ml-auto flex gap-2">
                  {!spent && (
                    <button
                      className={btn}
                      onClick={() => setLink({ title: "Invite link", url: `${origin}/login?invite=${i.code}` })}
                    >
                      Show link
                    </button>
                  )}
                  <button className={btnDanger} disabled={busy} onClick={() => revoke(i.code)}>
                    Revoke
                  </button>
                </span>
              </div>
            );
          })
        )}
      </Section>

      <Section
        title="Logins"
        count={accounts?.length}
        desc="This site sends no email, so a forgotten password is fixed here: make a reset link and pass it to the member yourself."
      >
        {(accounts ?? []).map((a) => (
          <div
            key={a.uid}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t-[0.5px] border-field px-4 py-2.5 text-[11.5px] first:border-t-0"
          >
            <span className="min-w-0">
              <span className="font-bold">{nameOf(a)}</span>
              {a.role === "admin" && <span className="ml-2 text-heart">admin</span>}
              {a.disabled && <span className="ml-2 text-warn">locked out</span>}
              {a.totpEnabled && <span className="ml-2 text-dim">2FA</span>}
              <span className="block truncate text-dim">{a.email}</span>
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button className={btn} disabled={busy} onClick={() => resetLink(a)}>
                Reset link
              </button>
              {a.uid !== user?.uid && (
                <>
                  <button
                    className={btn}
                    disabled={busy}
                    onClick={() => setRole(a, a.role === "admin" ? "member" : "admin")}
                  >
                    {a.role === "admin" ? "Remove admin" : "Make admin"}
                  </button>
                  <button className={btn} disabled={busy} onClick={() => setDisabled(a, !a.disabled)}>
                    {a.disabled ? "Let back in" : "Lock out"}
                  </button>
                  <button className={btnDanger} disabled={busy} onClick={() => remove(a)}>
                    Remove
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
      </Section>

      {site && (
        <Section
          title="Site"
          desc="The name, colour and rules chosen during setup. The port and data folder are set on the server itself — run the setup command there to change them."
        >
          <div className="grid gap-3.5 px-4 py-4 sm:grid-cols-2">
            <label>
              <span className={label}>Name</span>
              <input
                value={site.siteName}
                maxLength={40}
                onChange={(e) => patch({ siteName: e.target.value })}
                className={inputCls}
              />
            </label>
            <label>
              <span className={label}>Tagline</span>
              <input
                value={site.tagline}
                maxLength={120}
                onChange={(e) => patch({ tagline: e.target.value })}
                className={inputCls}
              />
            </label>
            <label>
              <span className={label}>Accent colour</span>
              <span className="flex items-center gap-2.5">
                <input
                  type="color"
                  value={site.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border-[0.5px] border-edge bg-transparent"
                />
                <span className="font-mono text-[11.5px] text-mut">{site.accent}</span>
              </span>
            </label>
            <label>
              <span className={label}>Who can sign up</span>
              <select
                value={site.signup}
                onChange={(e) => patch({ signup: e.target.value as SiteSettings["signup"] })}
                className={selectCls}
              >
                <option value="invite">People with an invite link</option>
                <option value="open">Anyone who finds the site</option>
                <option value="closed">Nobody</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className={label}>Public address</span>
              <input
                value={site.publicUrl}
                placeholder="https://photos.example.com"
                onChange={(e) => patch({ publicUrl: e.target.value })}
                className={inputCls}
              />
              <span className="mt-1 block text-[10.5px] text-dim">
                Used when making invite and reset links. Leave empty to use whatever address you
                are browsing from.
              </span>
            </label>
            <label>
              <span className={label}>Time zone</span>
              <input
                value={site.timeZone}
                placeholder="America/New_York"
                onChange={(e) => patch({ timeZone: e.target.value })}
                className={inputCls}
              />
              <span className="mt-1 block text-[10.5px] text-dim">
                The clock streaks and the daily moment are judged by.
              </span>
            </label>
            <div>
              <span className={label}>Daily moment</span>
              <label className="flex items-center gap-2 text-[11.5px] text-body">
                <input
                  type="checkbox"
                  checked={site.dailyMoment.enabled}
                  onChange={(e) => patchMoment({ enabled: e.target.checked })}
                />
                Remind everyone to post at
                <input
                  type="time"
                  value={site.dailyMoment.time}
                  onChange={(e) => patchMoment({ time: e.target.value })}
                  className={`${inputCls} !w-auto`}
                />
              </label>
              <label className="mt-2 flex items-center gap-2 text-[11.5px] text-body">
                <input
                  type="checkbox"
                  checked={site.dailyMoment.bothHalves}
                  onChange={(e) => patchMoment({ bothHalves: e.target.checked })}
                />
                Morning and evening posts both earn the badge
              </label>
              <label className="mt-2 flex items-center gap-2 text-[11.5px] text-body">
                Special date (MM-DD)
                <input
                  value={site.dailyMoment.specialDate}
                  placeholder="none"
                  maxLength={5}
                  onChange={(e) => patchMoment({ specialDate: e.target.value })}
                  className={`${inputCls} !w-24`}
                />
              </label>
              <span className="mt-1 block text-[10.5px] text-dim">
                Posts made on the minute get a glowing badge. Every post on the special date gets
                one too.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t-[0.5px] border-field px-4 py-3.5">
            <button onClick={saveSite} disabled={busy} className={btnPrimary}>
              Save
            </button>
            {!site.pushReady && (
              <span className="text-[10.5px] text-warn">
                Push notifications are off — run the setup command on the server to create keys.
              </span>
            )}
          </div>
        </Section>
      )}
    </>
  );
}
