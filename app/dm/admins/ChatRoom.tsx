"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useKeyboardInset } from "@/lib/sheet";
import ViewportShell from "@/components/ViewportShell";
import { MAX_NOTE_LENGTH, type AdminNote } from "@/lib/admin-chat";
import { stampLabel } from "@/lib/dates";
import { afterSend, isSendEnter } from "@/lib/keys";

// The conversation screen shared by both sides of the admins chat:
// a member writing to the admin, and the admin answering one member. Same
// bubbles, same iOS keyboard handling as a DM thread — only the header, the
// banner and which side counts as "mine" differ.

// Show a timestamp divider when more than an hour passed between notes.
const STAMP_GAP_MS = 3_600_000;

// Within this of the bottom, a new note pulls the view down with it.
const FOLLOW_SLACK_PX = 120;

function stampOf(at: AdminNote["at"]) {
  return at ? stampLabel(at.toDate()) : "";
}

export default function ChatRoom({
  backHref,
  avatar,
  title,
  subtitle,
  banner,
  notes,
  mineSide,
  incomingLabel,
  autoAck,
  emptyText,
  placeholder,
  onSend,
}: {
  backHref: string;
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  banner?: ReactNode;
  notes: AdminNote[] | null;
  mineSide: "user" | "admin";
  // Small caption above the first bubble of each incoming run — this is how
  // the admin's side is always signed as the site admin.
  incomingLabel?: string;
  // Rendered, never stored: the receipt the member sees the moment their note
  // lands. Derived from the thread's shape so nothing can forge an admin
  // message by writing one, and so it survives a reload unchanged.
  autoAck?: string;
  emptyText: string;
  placeholder: string;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const { inset, visibleHeight } = useKeyboardInset();

  // iOS pans the whole layout viewport up to reveal a focused input, dragging
  // the header off the top — and the offset sticks. The shell is already sized
  // to the visible viewport, so snap any attempt straight back to 0.
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

  // Stick to the bottom: jump on first load, smooth-follow new notes, re-pin
  // when the keyboard resizes the list — unless the reader has scrolled up
  // into history and the new note isn't their own.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !notes) return;
    const first = lastCount.current === 0;
    const grew = !first && notes.length > lastCount.current;
    lastCount.current = notes.length;
    // Your own note just sent is the one exception: you want to see it.
    if (!first && !atBottom.current && !(grew && notes[notes.length - 1]?.from === mineSide)) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: grew ? "smooth" : "auto" });
      atBottom.current = true;
    });
  }, [notes, inset, mineSide]);

  // The receipt hangs off the member's most recent word — it disappears once
  // the admin actually answers, which is the whole point of it.
  const showAck = Boolean(autoAck && notes?.length && notes[notes.length - 1].from === "user");

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const sent = text;
    setBusy(true);
    setSendError(false);
    try {
      await onSend(trimmed);
      setText((current) => afterSend(current, sent));
    } catch {
      setSendError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ViewportShell
      style={inset > 0 && visibleHeight > 0 ? { height: visibleHeight } : undefined}
    >
      <header className="mt-[env(safe-area-inset-top)] flex h-[52px] shrink-0 items-center gap-1.5 border-b-[0.5px] border-line px-3">
        <Link
          href={backHref}
          aria-label="Back"
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
        <div className="flex min-w-0 items-center gap-2.5">
          {avatar}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold tracking-[-0.2px]">{title}</p>
            {subtitle && <p className="truncate text-[11px] text-meta">{subtitle}</p>}
          </div>
        </div>
      </header>

      <div
        ref={listRef}
        className="flex flex-1 flex-col gap-[3px] overflow-y-auto overscroll-contain px-4 py-3"
      >
        {banner}

        {notes === null && (
          <p className="py-8 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            Loading
          </p>
        )}

        {notes?.length === 0 && (
          <p className="py-8 text-center text-[13px] text-dim">{emptyText}</p>
        )}

        {notes?.map((n, i) => {
          const prev = notes[i - 1];
          const showStamp =
            n.at && (!prev?.at || n.at.toMillis() - prev.at.toMillis() > STAMP_GAP_MS);
          const mine = n.from === mineSide;
          const labelled = Boolean(incomingLabel) && !mine && prev?.from !== n.from;
          return (
            <div key={n.id} className="flex flex-col">
              {showStamp && (
                <p className="py-2.5 text-center text-[10px] font-semibold tracking-[0.5px] text-dim">
                  {stampOf(n.at)}
                </p>
              )}
              {labelled && (
                <p className="mb-1 mt-1.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-meta">
                  {incomingLabel}
                </p>
              )}
              <div
                className={`max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
                  mine
                    ? "self-end rounded-br-md bg-white text-black"
                    : "self-start rounded-bl-md bg-field text-white"
                }`}
              >
                {n.text}
              </div>
            </div>
          );
        })}

        {showAck && (
          <div className="flex flex-col">
            {incomingLabel && (
              <p className="mb-1 mt-1.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-meta">
                {incomingLabel}
              </p>
            )}
            <div className="max-w-[78%] self-start rounded-2xl rounded-bl-md bg-field px-3.5 py-2 text-[15px] leading-snug text-white">
              {autoAck}
            </div>
          </div>
        )}
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
            onKeyDown={(e) => isSendEnter(e) && handleSend()}
            placeholder={placeholder}
            maxLength={MAX_NOTE_LENGTH}
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-full border-[0.5px] border-edge bg-field px-4 py-2 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-mut"
          />
          <button
            onClick={handleSend}
            disabled={busy || !text.trim()}
            aria-label="Send"
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
