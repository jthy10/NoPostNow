"use client";

import { useState } from "react";
import { createPost } from "@/lib/posts";
import { notifyNewPost } from "@/lib/push";
import { invalidateFeedCache } from "@/lib/feed-cache";
import {
  useKeyboardInset,
  useBodyScrollLock,
  useSwipeDismiss,
  useEscapeToClose,
} from "@/lib/sheet";

export default function UploadSheet({
  file,
  uid,
  username,
  onClose,
  onPosted,
}: {
  file: File;
  uid: string;
  username: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [preview] = useState(() => URL.createObjectURL(file));
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const { inset, visibleHeight } = useKeyboardInset();
  useBodyScrollLock();

  const busy = progress !== null;
  // No swiping away mid-upload — matches requestClose's busy guard.
  const { sheetRef, dragY, dragging } = useSwipeDismiss(requestClose, {
    enabled: !busy,
  });
  useEscapeToClose(requestClose);

  function requestClose() {
    if (busy) return;
    setClosing(true);
    setTimeout(onClose, 250);
  }

  async function handleSend() {
    if (busy) return;
    setProgress(0);
    setError(null);
    try {
      const postId = await createPost({ file, caption, uid, username, onProgress: setProgress });
      void notifyNewPost(username, caption, postId); // fire-and-forget push + bell fan-out
      // The cached feed no longer matches the server — landing on / must
      // refetch so the poster sees their new photo immediately.
      invalidateFeedCache();
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setProgress(null);
    }
  }

  return (
    <div
      // paddingBottom lifts the sheet above the iOS keyboard (see useKeyboardInset).
      // Backdrop dims out as the sheet is dragged down.
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
        className={`w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t-[0.5px] border-[#222] bg-card px-4 pb-[calc(20px+env(safe-area-inset-bottom))] transition-transform duration-250 ${
          closing ? "translate-y-full" : "animate-[sheet-up_0.3s_ease-out]"
        }`}
        style={{
          ...(inset > 0 && visibleHeight > 0 ? { maxHeight: visibleHeight - 24 } : undefined),
          // Follow the finger while dragging; transition off so it tracks 1:1.
          transform: !closing && dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-[#333]" />

        <div className="flex items-center justify-between pb-3 pt-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[1.5px]">New Post</span>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="px-0.5 text-[22px] leading-none text-mut transition-colors hover:text-white"
          >
            ×
          </button>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview}
          alt="preview"
          className="max-h-[50vh] w-full rounded-lg object-contain"
        />
        <div className="relative mt-3">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption…"
            maxLength={70}
            disabled={busy}
            className="w-full rounded-lg border-[0.5px] border-edge bg-field px-3.5 py-3 pr-14 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-mut disabled:opacity-60"
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-dim">
            {caption.length}/70
          </span>
        </div>
        {error && (
          <p className="mt-2 rounded-lg border-[0.5px] border-[#5c1a1a] bg-[#1a0a0a] px-3.5 py-3 text-[13px] leading-snug text-[#e74c3c]">
            {error}
          </p>
        )}
        {busy && (
          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-white transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
        <button
          onClick={handleSend}
          disabled={busy}
          className="mt-3 w-full rounded-lg bg-white p-3.5 text-sm font-extrabold tracking-[0.3px] text-black transition-opacity active:opacity-75 disabled:opacity-30"
        >
          {busy ? `Posting… ${Math.round(progress * 100)}%` : "Send Photo"}
        </button>
      </div>
    </div>
  );
}
