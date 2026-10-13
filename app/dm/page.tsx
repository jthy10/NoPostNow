"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  useThreads,
  useStandalone,
  isThreadUnread,
  isThreadCleared,
  peerUidOf,
  clearThread,
} from "@/lib/dms";
import { useBlockSets } from "@/lib/blocks";
import { useNamesByUid } from "@/lib/users";
import { timeAgo } from "@/lib/notifications";
import Avatar from "@/components/Avatar";
import PageHeader from "@/components/PageHeader";
import DmInstallPitch from "@/components/DmInstallPitch";
import UserSearchSheet from "@/components/UserSearchSheet";
import AdminChatRow from "@/components/AdminChatRow";
import ViewportShell from "@/components/ViewportShell";

const composeIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-[22px] w-[22px]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

const trashIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-[19px] w-[19px]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

export default function MessagesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const standalone = useStandalone();
  const allThreads = useThreads(user?.uid);
  const { hidden } = useBlockSets(user?.uid);
  const names = useNamesByUid();
  const [searching, setSearching] = useState(false);
  const [editRequested, setEditRequested] = useState(false);

  // Threads with someone blocked (either direction) disappear from the list;
  // unblocking brings them back with their history intact.
  const threads =
    allThreads && user
      ? allThreads.filter((t) => {
          const peer = peerUidOf(t.id, user.uid);
          if (peer && hidden.has(peer)) return false;
          return !isThreadCleared(t, user.uid);
        })
      : allThreads;

  // Derived, not stored: deleting the last conversation leaves nothing to
  // edit, and the mode drops out on its own instead of stranding a lone
  // Done button over an empty list.
  const editing = editRequested && Boolean(threads?.length);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);


  // Deletes only your side. The thread and its messages are immutable by
  // rule; this stamps your clear pointer, so the other person keeps the
  // conversation and a later reply brings yours back with just what is new.
  const deleteThread = async (threadId: string, name: string) => {
    if (!user) return;
    if (
      !confirm(
        `Delete this conversation with ${name}?

It disappears for you only — ${name} keeps their copy, and a new message from them brings the thread back.`
      )
    )
      return;
    try {
      await clearThread(threadId, user.uid);
    } catch {
      alert("Could not delete that conversation. Try again.");
    }
  };

  if (loading || !user || standalone === null) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  if (!standalone) return <DmInstallPitch />;

  return (
    <>
      <ViewportShell>
      <PageHeader
        backHref="/notifications"
        title="Messages"
        right={
          <>
            {/* Edit only appears once there is something to delete — the
                pinned admins row is not removable, so it does not count. */}
            {Boolean(threads?.length) && (
              <button
                onClick={() => setEditRequested((v) => !v)}
                className="px-2 py-1.5 text-[13px] font-bold text-white transition-opacity active:opacity-60"
              >
                {editing ? "Done" : "Edit"}
              </button>
            )}
            {!editing && (
              <button
                onClick={() => setSearching(true)}
                aria-label="New message"
                className="p-1.5 text-white transition-opacity active:opacity-60"
              >
                {composeIcon}
              </button>
            )}
          </>
        }
      />

      <main className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-contain pb-6 pt-[calc(52px+env(safe-area-inset-top))]">
        {/* Pinned above everything, and never removable — this is the chat
            that replaced a buried settings form nobody could find. */}
        <AdminChatRow uid={user.uid} admin={user.isAdmin} />

        {threads === null && (
          <p className="py-10 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            Loading
          </p>
        )}

        {threads?.length === 0 && (
          <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
            <p className="text-sm text-mut">No conversations yet.</p>
            <button
              onClick={() => setSearching(true)}
              className="rounded-lg bg-white px-6 py-2.5 text-xs font-extrabold text-black transition-opacity active:opacity-75"
            >
              New Message
            </button>
          </div>
        )}

        {threads?.map((t) => {
          const peerUid = peerUidOf(t.id, user.uid);
          // Prefer the peer's current name (resolves renames instantly), fall
          // back to the name cached on the thread, then to a placeholder.
          const name =
            (peerUid && (names.get(peerUid) ?? t.names?.[peerUid])) || "Someone";
          const unread = isThreadUnread(t, user.uid);
          const rowClass =
            "flex items-center gap-3 border-b-[0.5px] border-field px-4 py-3 transition-colors active:bg-card";
          const body = (
            <>
              <Avatar username={name} className="h-12 w-12 text-sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[14px] font-bold">{name}</p>
                  <span className="shrink-0 text-[11px] text-meta">{timeAgo(t.lastAt)}</span>
                </div>
                <p
                  className={`truncate text-[13px] ${
                    unread ? "font-semibold text-white" : "text-mut"
                  }`}
                >
                  {t.lastFrom === user.uid ? `You: ${t.lastText}` : t.lastText}
                </p>
              </div>
            </>
          );
          // In edit mode the row stops being a link — a tap meant for the
          // trash must never open the conversation instead.
          return editing ? (
            <div key={t.id} className={rowClass}>
              {body}
              <button
                onClick={() => void deleteThread(t.id, name)}
                aria-label={`Delete conversation with ${name}`}
                className="-mr-1 shrink-0 p-2 text-heart transition-opacity active:opacity-60"
              >
                {trashIcon}
              </button>
            </div>
          ) : (
            <Link key={t.id} href={`/dm/${t.id}`} className={rowClass}>
              {body}
              {unread && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-heart" aria-label="Unread" />
              )}
            </Link>
          );
        })}
      </main>
      </ViewportShell>

      {searching && <UserSearchSheet myUid={user.uid} onClose={() => setSearching(false)} />}
    </>
  );
}
