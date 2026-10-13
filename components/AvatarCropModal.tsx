"use client";

import { useRef, useState } from "react";

// Port of the original site's avatar crop flow: drag to reposition,
// slider to zoom, output a 400px square JPEG.
const VIEWPORT = 280;
const OUTPUT = 400;

export default function AvatarCropModal({
  src,
  onCancel,
  onCropped,
}: {
  src: string;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const fitScale = natural ? Math.max(VIEWPORT / natural.w, VIEWPORT / natural.h) : 1;

  function clamp(p: { x: number; y: number }, s: number) {
    if (!natural) return p;
    return {
      x: Math.min(0, Math.max(p.x, VIEWPORT - natural.w * s)),
      y: Math.min(0, Math.max(p.y, VIEWPORT - natural.h * s)),
    };
  }

  function handleLoad() {
    const img = imgRef.current!;
    const n = { w: img.naturalWidth, h: img.naturalHeight };
    const fit = Math.max(VIEWPORT / n.w, VIEWPORT / n.h);
    setNatural(n);
    setScale(fit);
    setPos({
      x: (VIEWPORT - n.w * fit) / 2,
      y: (VIEWPORT - n.h * fit) / 2,
    });
  }

  // Zoom anchored on the viewport centre so the subject stays put.
  function changeScale(next: number) {
    const c = VIEWPORT / 2;
    setPos((p) =>
      clamp({ x: c - (c - p.x) * (next / scale), y: c - (c - p.y) * (next / scale) }, next)
    );
    setScale(next);
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    setPos(
      clamp({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }, scale)
    );
  }
  function handlePointerUp() {
    dragStart.current = null;
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img || !natural) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d")!;
    const srcX = -pos.x / scale;
    const srcY = -pos.y / scale;
    const srcSize = VIEWPORT / scale;
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex animate-[fade-in_0.2s_ease-out] flex-col items-center justify-center gap-5 bg-black/90 px-6">
      <div
        className="relative h-[280px] w-[280px] touch-none overflow-hidden rounded-full border-2 border-white bg-card"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={handleLoad}
          className="absolute max-w-none cursor-grab select-none active:cursor-grabbing"
          style={
            natural
              ? {
                  width: natural.w * scale,
                  height: natural.h * scale,
                  left: pos.x,
                  top: pos.y,
                }
              : { opacity: 0 }
          }
        />
      </div>

      <p className="text-center text-[13px] text-[#888]">Drag to reposition · slide to zoom</p>

      <input
        type="range"
        min={fitScale}
        max={fitScale * 4}
        step={0.01}
        value={scale}
        onChange={(e) => changeScale(parseFloat(e.target.value))}
        aria-label="Zoom"
        className="w-[200px] accent-white"
      />

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg bg-[#222] px-7 py-3 text-sm font-extrabold text-white transition-opacity active:opacity-75"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!natural}
          className="rounded-lg bg-white px-7 py-3 text-sm font-extrabold text-black transition-opacity active:opacity-75 disabled:opacity-30"
        >
          Use Photo
        </button>
      </div>
    </div>
  );
}
