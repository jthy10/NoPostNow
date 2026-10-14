"use client";

import Link from "next/link";
import {
  ADMIN_CHAT_HREF,
  adminChatName,
  ADMIN_CHAT_TAGLINE,
  adminSenderName,
  isUnreadForAdmin,
  isUnreadForMember,
  useAdminChat,
  useAllAdminChats,
} from "@/lib/admin-chat";
import { useNamesByUid } from "@/lib/users";
import { timeAgo } from "@/lib/notifications";
import AdminChatAvatar from "./AdminChatAvatar";

// The admins row, pinned to the top of everyone's messages list — the
// one conversation nobody has to find. Members see their own chat with the
// admins; the admin sees every member's notes stacked into one inbox.
export default function AdminChatRow({
  uid,
  admin,
}: {
  uid: string;
  admin: boolean;
}) {
  // Only one of these actually subscribes: a member can't list the collection,
  // and the admin doesn't have a chat of their own to read.
  const mine = useAdminChat(admin ? undefined : uid);
  const all = useAllAdminChats(admin);
  const names = useNamesByUid();

  const latest = admin ? all?.[0] : mine;
  const unread = admin ? Boolean(all?.some(isUnreadForAdmin)) : isUnreadForMember(mine);

  let preview = admin
    ? "Notes from members land here"
    : ADMIN_CHAT_TAGLINE;
  if (latest?.lastText) {
    if (admin) {
      const who =
        latest.lastFrom === "admin"
          ? "You"
          : names.get(latest.uid) || latest.username || "Someone";
      preview = `${who}: ${latest.lastText}`;
    } else {
      preview =
        latest.lastFrom === "user"
          ? `You: ${latest.lastText}`
          : `${adminSenderName()}: ${latest.lastText}`;
    }
  }

  return (
    <Link
      href={ADMIN_CHAT_HREF}
      className="flex items-center gap-3 border-b-[0.5px] border-field px-4 py-3 transition-colors active:bg-card"
    >
      <AdminChatAvatar className="h-12 w-12 text-[13px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[14px] font-bold">{adminChatName()}</p>
          <span className="shrink-0 text-[11px] text-meta">{timeAgo(latest?.lastAt ?? null)}</span>
        </div>
        <p className={`truncate text-[13px] ${unread ? "font-semibold text-white" : "text-mut"}`}>
          {preview}
        </p>
      </div>
      {unread && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-heart" aria-label="Unread" />
      )}
    </Link>
  );
}
