"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  ADMIN_AUTO_REPLY,
  ADMIN_CHAT_BANNER,
  adminChatName,
  adminSenderName,
  isUnreadForMember,
  markAdminChatSeen,
  sendAdminNote,
  useAdminChat,
  useAdminNotes,
} from "@/lib/admin-chat";
import { notifyAdminNote } from "@/lib/push";
import AdminChatAvatar from "@/components/AdminChatAvatar";
import ChatRoom from "./ChatRoom";

// A member's side of the admins chat: the banner explaining what it
// is for, their own notes, and whatever the admin has written back.
export default function MemberChat({ uid }: { uid: string }) {
  const { username } = useAuth();
  const chat = useAdminChat(uid);
  const notes = useAdminNotes(uid);

  // Reading clears the unread dot on the /dm row and the chat badge.
  useEffect(() => {
    if (isUnreadForMember(chat)) void markAdminChatSeen(uid, "user");
  }, [uid, chat]);

  return (
    <ChatRoom
      backHref="/dm"
      avatar={<AdminChatAvatar className="h-8 w-8 text-[10px]" />}
      title={adminChatName()}
      subtitle="Straight to the people building this"
      banner={
        <div className="mb-3 rounded-lg border-[0.5px] border-edge bg-card p-3.5">
          <p className="text-[13px] font-bold">You&apos;re talking to the developers</p>
          <p className="mt-0.5 text-[11px] leading-snug text-meta">{ADMIN_CHAT_BANNER}</p>
        </div>
      }
      notes={notes}
      mineSide="user"
      incomingLabel={adminSenderName()}
      autoAck={ADMIN_AUTO_REPLY}
      emptyText="What's on your mind? 👋"
      placeholder="Message…"
      onSend={async (text) => {
        await sendAdminNote({ uid, username: username || "Anonymous", text });
        void notifyAdminNote(text);
      }}
    />
  );
}
