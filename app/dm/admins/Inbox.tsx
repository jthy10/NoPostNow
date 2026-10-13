"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  adminChatName,
  isAwaitingReply,
  isUnreadForAdmin,
  markAdminChatSeen,
  useAdminInbox,
  useAllAdminChats,
  type AdminChat,
} from "@/lib/admin-chat";
import { useNamesByUid } from "@/lib/users";
import { useStandalone } from "@/lib/dms";
import { timeAgo } from "@/lib/notifications";
import Avatar from "@/components/Avatar";
import PageHeader from "@/components/PageHeader";
import ViewportShell from "@/components/ViewportShell";

// The admin's side: not a conversation but an inbox. Every note every member
// has written, newest first, each one answerable on the spot — tapping Reply
// opens that member's chat, where anything sent is signed as the site admin.
export default function Inbox() {
  const standalone = useStandalone();
  const chats = useAllAdminChats(true);
  const notes = useAdminInbox(chats);
  const names = useNamesByUid();
  const marked = useRef(new Set<string>());

  const chatByUid = useMemo(() => {
    const map = new Map<string, AdminChat>();
    for (const c of chats ?? []) map.set(c.uid, c);
    return map;
  }, [chats]);

  // Opening the inbox is reading it: the badge clears here, once per chat.
  // What still needs an answer stays marked "Awaiting reply" below, which is
  // derived from the messages themselves and so survives being read.
  useEffect(() => {
    for (const chat of chats ?? []) {
      if (isUnreadForAdmin(chat) && !marked.current.has(chat.uid)) {
        marked.current.add(chat.uid);
        void markAdminChatSeen(chat.uid, "admin");
      }
    }
  }, [chats]);

  // Members' notes only — the admin's own replies live inside each chat.
  const fromMembers = notes?.filter((n) => n.from === "user" && n.uid) ?? null;
  const waiting = fromMembers?.filter((n) => isAwaitingReply(n, chatByUid.get(n.uid))).length ?? 0;

  return (
    <ViewportShell>
      {/* /dm is app-only, so a browser back-arrow into it is a dead end —
          send desktop back where the Notes button lives instead. */}
      <PageHeader backHref={standalone === false ? "/profile" : "/dm"} title={adminChatName()} />

      <main className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-contain pb-8 pt-[calc(52px+env(safe-area-inset-top))]">
        <div className="border-b-[0.5px] border-field px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-meta">
            {waiting > 0
              ? `${waiting} note${waiting === 1 ? "" : "s"} awaiting a reply`
              : "Every note members have sent"}
          </p>
        </div>

        {fromMembers === null && (
          <p className="py-10 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
            Loading
          </p>
        )}

        {fromMembers?.length === 0 && (
          <p className="px-8 py-16 text-center text-sm text-mut">
            No notes yet. Everyone sees this chat in their messages — bug reports and
            feature requests land here.
          </p>
        )}

        {fromMembers?.map((n) => {
          const chat = chatByUid.get(n.uid);
          const name = names.get(n.uid) || chat?.username || "Someone";
          const awaiting = isAwaitingReply(n, chat);
          return (
            <div
              key={n.id}
              className={`border-b-[0.5px] border-field px-4 py-3.5 ${
                awaiting ? "" : "opacity-60"
              }`}
            >
              <div className="flex items-start gap-3">
                <Link href={`/u/${n.uid}`} className="shrink-0">
                  <Avatar username={name} className="h-10 w-10 text-[11px]" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[14px] font-bold">{name}</p>
                    <span className="shrink-0 text-[11px] text-meta">{timeAgo(n.at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-body">
                    {n.text}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <Link
                      href={`/dm/admins/${n.uid}`}
                      className="rounded-full bg-white px-4 py-1.5 text-[11px] font-extrabold text-black transition-opacity active:opacity-75"
                    >
                      Reply
                    </Link>
                    {!awaiting && (
                      <span className="text-[11px] font-semibold uppercase tracking-[1px] text-ok">
                        Replied
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </main>
    </ViewportShell>
  );
}
