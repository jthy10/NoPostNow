"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMessageableUsers, type UserMeta } from "@/lib/users";
import { threadIdFor, useAppUids } from "@/lib/dms";
import { useBlockSets } from "@/lib/blocks";
import {
  useKeyboardInset,
  useBodyScrollLock,
  useSwipeDismiss,
  useEscapeToClose,
} from "@/lib/sheet";
import Avatar from "./Avatar";

// "New message": search members by name, tap to open the thread.
// Friends who don't have the app yet are still messageable — the row says
// you'll be inviting them, and the thread view explains how that works.
export default function UserSearchSheet({
  myUid,
  onClose,
}: {
  myUid: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<UserMeta[] | null>(null);
  const [q, setQ] = useState("");
  const [closing, setClosing] = useState(false);
  const appUids = useAppUids();
  const { hidden } = useBlockSets(myUid);
  const { inset, visibleHeight } = useKeyboardInset();
  const listRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock();
  // scrollRef points at the list so dragging down scrolls it instead of
  // dismissing the sheet (dismiss only engages when the list is at the top).
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
    const onApp = (u: UserMeta) => (appUids ? appUids.has(u.uid!) : true);
    return users
      .filter(
        (u) =>
          u.uid !== myUid &&
          u.username !== "Anonymous" &&
          (!u.uid || !hidden.has(u.uid)) &&
          (!needle || u.username.toLowerCase().includes(needle))
      )
      .sort(
        (a, b) =>
          // messageable first (a uid is required to open a thread),
          // app users above browser users, then alphabetical
          Number(Boolean(b.uid)) - Number(Boolean(a.uid)) ||
          Number(onApp(b)) - Number(onApp(a)) ||
          a.username.localeCompare(b.username)
      );
  }, [users, q, myUid, appUids, hidden]);

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

        <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[1.5px]">
            New Message
          </span>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="px-0.5 text-[22px] leading-none text-mut transition-colors hover:text-white"
          >
            ×
          </button>
        </div>

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
          {results?.map((u) => {
            const hasApp = appUids ? appUids.has(u.uid!) : true;
            return (
              <button
                key={u.uid ?? u.username}
                disabled={!u.uid}
                onClick={() => u.uid && router.push(`/dm/${threadIdFor(myUid, u.uid)}`)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-field disabled:opacity-45"
              >
                <Avatar username={u.username} className="h-10 w-10 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{u.username}</p>
                  {!u.uid ? (
                    <p className="text-[11px] text-mut">
                      Can&apos;t message yet — they need to sign in once
                    </p>
                  ) : (
                    !hasApp && <p className="text-[11px] text-mut">Not on the app yet</p>
                  )}
                </div>
                {u.uid && !hasApp && (
                  <span className="shrink-0 rounded-full border-[0.5px] border-edge px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.8px] text-mut">
                    Invite to app
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
