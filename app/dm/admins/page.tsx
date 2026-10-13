"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useStandalone } from "@/lib/dms";
import DmInstallPitch from "@/components/DmInstallPitch";
import Inbox from "./Inbox";
import MemberChat from "./MemberChat";

// One URL, two screens. A member gets their own chat with the developers;
// the admin gets the inbox of everyone's notes. Same address either way, so
// a push notification about this chat lands correctly for both.
export default function AdminChatPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const standalone = useStandalone();
  const admin = user?.isAdmin === true;

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user || standalone === null) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  // Members reach this the same way they reach any other message — from the
  // installed app. The admin is exempt: answering bug reports from a laptop
  // is the entire point of moving them out of the admin console.
  if (!standalone && !admin) return <DmInstallPitch />;

  return admin ? <Inbox /> : <MemberChat uid={user.uid} />;
}
