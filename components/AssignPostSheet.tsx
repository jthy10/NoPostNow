"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMessageableUsers, type UserMeta } from "@/lib/users";
import {
  useKeyboardInset,
  useBodyScrollLock,
  useSwipeDismiss,
  useEscapeToClose,
} from "@/lib/sheet";
import Avatar from "./Avatar";

// Admin legacy cleanup: pick the member an Anonymous post really belongs to.
// Only members with a known uid are selectable — assignment writes that uid
// onto the photo doc so the post links to their profile.
export default function AssignPostSheet({
  onSelect,
  onClose,
}: {
  onSelect: (user: { uid: string; username: string }) => void;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<UserMeta[] | null>(null);
  const [q, setQ] = useState("");
  const [closing, setClosing] = useState(false);
  const { inset, visibleHeight } = useKeyboardInset();
  const listRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock();
  const { sheetRef, dragY, dragging } = useSwipeDismiss(requestClose, {
    scrollRef: listRef,
  });
  useEscapeToClose(requestClose);

  useEffect(() => {
    let cancelled = false;
    fetchMessageableUsers().then((list) => {
      if (!cancelled) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function requestClose() {
    setClosing(true);
    setTimeout(onClose, 250);
  }

  const results = useMemo(() => {
    if (!users) return null;
    const needle = q.trim().toLowerCase();
    return users
      .filter(
        (u) =>
          u.username !== "Anonymous" &&
          (!needle || u.username.toLowerCase().includes(needle))
      )
      .sort(
        (a, b) =>
          // assignable first (a uid is required), then alphabetical
          Number(Boolean(b.uid)) - Number(Boolean(a.uid)) ||
          a.username.localeCompare(b.username)
      );
  }, [users, q]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end bg-black/70 transition-[opacity,padding] duration-250 ${
        closing ? "opacity-0" : "animate-[fade-in_0.25s_ease-out]"
      }`}
      style={{
        paddingBottom: inset,
        backgroundColor:
          !closing && dragY > 0
            ? `rgba(0,0,0,${(0.7 * Math.max(0, 1 - dragY / 500)).toFixed(3)})`
            : undefined,
      }}
      onClick={requestClose}
    >
      <div
        ref={sheetRef}
        className={`flex max-h-[75vh] min-h-[45vh] w-full flex-col rounded-t-2xl border-t-[0.5px] border-[#222] bg-card transition-transform duration-250 ${
          closing ? "translate-y-full" : "animate-[sheet-up_0.3s_ease-out]"
        }`}
        style={{
          ...(inset > 0 && visibleHeight > 0 ? { maxHeight: visibleHeight - 24 } : undefined),
          transform: !closing && dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-[#333]" />

        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[1.5px]">
            Assign Post
          </span>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="px-0.5 text-[22px] leading-none text-mut transition-colors hover:text-white"
          >
            ×
          </button>
        </div>
        <p className="shrink-0 px-4 pb-3 text-[11px] leading-relaxed text-dim">
          Link this Anonymous post to the member who posted it. They won&apos;t be
          notified.
        </p>

        <div className="shrink-0 px-4 pb-3">
          {/* 16px font — anything smaller makes iOS zoom the page on focus. */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="w-full rounded-full border-[0.5px] border-edge bg-field px-4 py-2.5 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-mut"
          />
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-contain pb-[calc(16px+env(safe-area-inset-bottom))]"
        >
          {results === null && (
            <p className="py-8 text-center text-[13px] text-dim">Loading…</p>
          )}
          {results?.length === 0 && (
            <p className="py-8 text-center text-[13px] text-dim">No one found.</p>
          )}
          {results?.map((u) => (
            <button
              key={u.uid ?? u.username}
              disabled={!u.uid}
              onClick={() => u.uid && onSelect({ uid: u.uid, username: u.username })}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-field disabled:opacity-45"
            >
              <Avatar username={u.username} className="h-10 w-10 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{u.username}</p>
                {!u.uid && (
                  <p className="text-[11px] text-mut">
                    No account uid yet — they need to sign in once
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
