"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { fetchMessageableUsers, type UserMeta } from "@/lib/users";
import { useBlockSets } from "@/lib/blocks";
import Avatar from "@/components/Avatar";
import PageHeader from "@/components/PageHeader";
import ViewportShell from "@/components/ViewportShell";

// Member directory: search everyone on the site by name, tap to open their
// profile. Reached from the magnifier on the notifications page.
export default function SearchPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserMeta[] | null>(null);
  const [q, setQ] = useState("");
  const { hidden } = useBlockSets(user?.uid);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchMessageableUsers().then((list) => {
      if (!cancelled) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const results = useMemo(() => {
    if (!users) return null;
    const needle = q.trim().toLowerCase();
    return users
      .filter(
        (u) =>
          u.username !== "Anonymous" &&
          (!u.uid || !hidden.has(u.uid)) &&
          (!needle || u.username.toLowerCase().includes(needle))
      )
      .sort(
        (a, b) =>
          // Profiles need a uid — visitable people first, then alphabetical.
          Number(Boolean(b.uid)) - Number(Boolean(a.uid)) ||
          a.username.localeCompare(b.username)
      );
  }, [users, q, hidden]);

  if (loading || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[2px] text-mut">
        Loading
      </div>
    );
  }

  return (
    <ViewportShell>
      <PageHeader backHref="/notifications" title="Search" />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <main className="mx-auto w-full max-w-lg pb-8 pt-[calc(52px+env(safe-area-inset-top))]">
          <div className="px-4 pb-1 pt-3">
            {/* 16px font — anything smaller makes iOS zoom the page on focus. */}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people…"
              autoFocus
              className="w-full rounded-full border-[0.5px] border-edge bg-field px-4 py-2.5 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-mut"
            />
          </div>

          {results === null && (
            <p className="py-10 text-center text-[11px] font-semibold uppercase tracking-[2px] text-dim">
              Loading
            </p>
          )}

          {results?.length === 0 && (
            <p className="py-10 text-center text-[13px] text-dim">No one found.</p>
          )}

          {results?.map((u) => (
            <button
              key={u.uid ?? u.username}
              disabled={!u.uid}
              onClick={() =>
                u.uid && router.push(u.uid === user.uid ? "/profile" : `/u/${u.uid}`)
              }
              className="flex w-full items-center gap-3 border-b-[0.5px] border-field px-4 py-3 text-left transition-colors active:bg-card disabled:opacity-45"
            >
              <Avatar username={u.username} className="h-11 w-11 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">
                  {u.username}
                  {u.uid === user.uid && (
                    <span className="ml-1.5 text-[11px] font-semibold text-mut">(you)</span>
                  )}
                </p>
                {!u.uid && (
                  <p className="text-[11px] text-mut">
                    No profile yet — they need to sign in once
                  </p>
                )}
              </div>
            </button>
          ))}
        </main>
      </div>
    </ViewportShell>
  );
}
