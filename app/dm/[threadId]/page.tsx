"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useBlockSets } from "@/lib/blocks";
import { useUserByUid } from "@/lib/users";
import {
  useThread,
  useMessages,
  useStandalone,
  useAppUids,
  sendMessage,
  markThreadSeen,
  isThreadUnread,
  peerUidOf,
  MAX_DM_LENGTH,
  type Message,
} from "@/lib/dms";
import { notifyDm } from "@/lib/push";
import { useKeyboardInset } from "@/lib/sheet";
import Avatar from "@/components/Avatar";
import DmInstallPitch from "@/components/DmInstallPitch";
import ViewportShell from "@/components/ViewportShell";

// Show a timestamp divider when more than an hour passed between messages.
const STAMP_GAP_MS = 3_600_000;

function stampLabel(m: Message) {
  if (!m.at) return "";
  const d = m.at.toDate();
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dayDiff = (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000;
  if (dayDiff === 0) return `TODAY ${time}`;
  if (dayDiff === 1) return `YESTERDAY ${time}`;
  const date = d
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    })
    .toUpperCase();
  return `${date}, ${time}`;
}

export default function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = use(params);
  const { user, username, loading } = useAuth();
  const router = useRouter();
  const standalone = useStandalone();
  const myUid = user?.uid;

  const member = Boolean(myUid && threadId.split("_").length === 2 && threadId.split("_").includes(myUid));
  const peerUid = myUid ? peerUidOf(threadId, myUid) : null;
  // A blocked thread vanishes from /dm, but the URL outlives the list — an
  // open tab, a bookmark, an old push. Without this the person you blocked
  // keeps typing into a thread you can no longer see, and each message pings
  // you. Treated exactly like a thread you don't belong to: bounce to /dm.
  const { hidden, ready: blocksReady } = useBlockSets(myUid);
  const blockedPeer = Boolean(peerUid && hidden.has(peerUid));
  const peerMeta = useUserByUid(peerUid);
  const appUids = useAppUids();
  const thread = useThread(member ? threadId : undefined);
  // Hold the message listener until the thread doc lands. It carries the
  // clear pointer, and subscribing before it arrives would flash the history
  // you deleted for the moment between the two snapshots.
  const messages = useMessages(
    member && thread !== undefined ? threadId : undefined,
    myUid && thread ? thread.clearedAt?.[myUid] : null
  );

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const { inset, visibleHeight } = useKeyboardInset();

  // iOS pans the whole layout viewport up to reveal a focused input, which
  // drags the header off the top of the screen — and the offset sticks until
  // the user scrolls it back. The shell is already sized to the visible
  // viewport (see the height style below), so the composer never needs that
  // pan; snap any attempt straight back to 0.
  useEffect(() => {
    const vv = window.visualViewport;
    const pin = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    };
    pin();
    window.addEventListener("scroll", pin);
    vv?.addEventListener("resize", pin);
    vv?.addEventListener("scroll", pin);
    return () => {
      window.removeEventListener("scroll", pin);
      vv?.removeEventListener("resize", pin);
      vv?.removeEventListener("scroll", pin);
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Malformed link, someone else's thread, or a blocked peer — nothing to
  // see here.
  useEffect(() => {
    if (user && (!member || blockedPeer)) router.replace("/dm");
  }, [user, member, blockedPeer, router]);

  // Reading the thread clears its unread state (list dot + chat badge).
  useEffect(() => {
    if (myUid && thread && isThreadUnread(thread, myUid)) {
      void markThreadSeen(threadId, myUid);
    }
  }, [myUid, thread, threadId]);

  // Stick to the bottom: jump on first load, smooth-follow new messages,
  // and re-pin when the keyboard resizes the list.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !messages) return;
    const smooth = lastCount.current > 0 && messages.length > lastCount.current;
    lastCount.current = messages.length;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }, [messages, inset]);

  // Hold the loading state until the block lists land, so a blocked thread
  // never flashes its history on the way to the redirect.
  if (loading || !user || !member || !blocksReady || blockedPeer || standalone === null) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  if (!standalone) return <DmInstallPitch />;

  // The peer's live name (from their users doc) wins over the snapshot cached
  // on the thread, so a rename shows immediately even if it was an admin's.
  const peerName =
    peerMeta?.username || (peerUid && thread?.names?.[peerUid]) || "…";
  const peerOnApp = !peerUid || !appUids ? true : appUids.has(peerUid);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || busy || !myUid || !peerUid || blockedPeer) return;
    setBusy(true);
    setSendError(false);
    try {
      await sendMessage({
        myUid,
        myName: username || "Anonymous",
        peerUid,
        peerName: peerMeta?.username || peerName,
        text: trimmed,
      });
      void notifyDm(trimmed, peerUid, threadId);
      setText("");
    } catch {
      setSendError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Keyboard open: size the frame to exactly the visible viewport instead
    // of padding it — header pinned to the top of the screen, composer
    // sitting right on top of the keyboard, messages list squeezed between.
    <ViewportShell
      style={inset > 0 && visibleHeight > 0 ? { height: visibleHeight } : undefined}
    >
      <header className="mt-[env(safe-area-inset-top)] flex h-[52px] shrink-0 items-center gap-1.5 border-b-[0.5px] border-line px-3">
        <Link
          href="/dm"
          aria-label="Back to messages"
          className="-ml-1 p-2 text-white transition-opacity active:opacity-60"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[22px] w-[22px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <Link href={peerUid ? `/u/${peerUid}` : "/dm"} className="flex min-w-0 items-center gap-2.5">
          <Avatar username={peerName} className="h-8 w-8 text-[10px]" />
          <span className="truncate text-[15px] font-extrabold tracking-[-0.2px]">
            {peerName}
          </span>
        </Link>
      </header>

      <div
        ref={listRef}
        className="flex flex-1 flex-col gap-[3px] overflow-y-auto overscroll-contain px-4 py-3"
      >
        {!peerOnApp && (
          <div className="mb-3 rounded-lg border-[0.5px] border-edge bg-card p-3.5">
            <p className="text-[13px] font-bold">{peerName} isn&apos;t on the app yet</p>
            <p className="mt-0.5 text-[11px] leading-snug text-meta">
              Sending a message invites them — next time they open the site
              they&apos;ll be told you texted and shown how to install the app to
              read it.
            </p>
          </div>
        )}

        {messages === null && (
          <p className="py-8 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            Loading
          </p>
        )}

        {messages?.length === 0 && (
          <p className="py-8 text-center text-[13px] text-dim">
            {peerOnApp ? `Say hi to ${peerName} 👋` : `Invite ${peerName} with a first message 👋`}
          </p>
        )}

        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const showStamp =
            m.at && (!prev?.at || m.at.toMillis() - prev.at!.toMillis() > STAMP_GAP_MS);
          const mine = m.from === user.uid;
          return (
            <div key={m.id} className="flex flex-col">
              {showStamp && (
                <p className="py-2.5 text-center text-[10px] font-semibold tracking-[0.5px] text-dim">
                  {stampLabel(m)}
                </p>
              )}
              <div
                className={`max-w-[78%] break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
                  mine
                    ? "self-end rounded-br-md bg-white text-black"
                    : "self-start rounded-bl-md bg-field text-white"
                }`}
              >
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={`shrink-0 border-t-[0.5px] border-line px-4 pt-2 ${
          inset > 0
            ? "pb-2.5"
            : "pwa-dm-composer-closed pb-[calc(12px+env(safe-area-inset-bottom))]"
        }`}
      >
        {sendError && (
          <p className="pb-2 text-center text-[11px] text-heart">
            Couldn&apos;t send — check your connection and try again.
          </p>
        )}
        <div className="flex items-center gap-2.5">
          {/* 16px font — anything smaller makes iOS zoom the page on focus. */}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Message…"
            maxLength={MAX_DM_LENGTH}
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-full border-[0.5px] border-edge bg-field px-4 py-2 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-mut"
          />
          <button
            onClick={handleSend}
            disabled={busy || !text.trim()}
            aria-label="Send message"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition-opacity disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </ViewportShell>
  );
}
