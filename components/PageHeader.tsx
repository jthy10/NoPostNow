"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// Fixed top bar for sub-pages (notifications, messages): back chevron,
// title, optional action slot on the right. Same metrics as TopNav so
// pages can keep the usual pt-[calc(52px+env(safe-area-inset-top))].
export default function PageHeader({
  backHref,
  title,
  right,
}: {
  backHref: string;
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <>
      <nav className="fixed inset-x-0 top-0 z-40 border-b-[0.5px] border-line bg-canvas pt-[env(safe-area-inset-top)]">
        <div className="flex h-[52px] items-center gap-1.5 px-3">
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
          <div className="min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-[-0.2px]">
            {title}
          </div>
          {right && <div className="flex shrink-0 items-center">{right}</div>}
        </div>
      </nav>
      {/* Status-bar backing, same as TopNav. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top)] bg-canvas" />
    </>
  );
}
