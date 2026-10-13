"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useUserByUid, useNamesByUid } from "@/lib/users";
import {
  adminSenderName,
  isUnreadForAdmin,
  markAdminChatSeen,
  sendAdminReply,
  useAdminChat,
  useAdminNotes,
} from "@/lib/admin-chat";
import { notifyAdminReply } from "@/lib/push";
import Avatar from "@/components/Avatar";
import ChatRoom from "../ChatRoom";

// The admin answering one member. Everything sent from here is signed
// as the site admin — the member never sees which account is behind it.
export default function AdminReplyPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const admin = user?.isAdmin === true;
  const chat = useAdminChat(admin ? uid : undefined);
  const notes = useAdminNotes(admin ? uid : undefined);
  const meta = useUserByUid(admin ? uid : undefined);
  const names = useNamesByUid();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Nobody but the admin has any business here — the rules say the same, but
  // bounce rather than render a screen that can only fail.
  useEffect(() => {
    if (user && !admin) router.replace("/dm");
  }, [user, admin, router]);

  // Opening a member's chat clears its unread state.
  useEffect(() => {
    if (admin && chat && isUnreadForAdmin(chat)) void markAdminChatSeen(uid, "admin");
  }, [admin, chat, uid]);

  if (loading || !user || !admin) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  const name = names.get(uid) || meta?.username || chat?.username || "Someone";

  return (
    <ChatRoom
      backHref="/dm/admins"
      avatar={<Avatar username={name} className="h-8 w-8 text-[10px]" />}
      title={name}
      subtitle={`Replying as ${adminSenderName()}`}
      notes={notes}
      mineSide="admin"
      emptyText={`Nothing from ${name} yet.`}
      placeholder={`Reply as ${adminSenderName()}…`}
      onSend={async (text) => {
        await sendAdminReply({ uid, text });
        void notifyAdminReply(text, uid);
      }}
    />
  );
}
