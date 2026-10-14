"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { downloadFile } from "./files";
import { displayVariantPath } from "./posts";

// Photos have no public URL. The bytes are fetched with the member's session
// and shown from an in-memory object URL, so access always depends on being
// signed in — a copied image address is useless to anyone else.
//
// Every fetched photo becomes an object URL, and an object URL pins its blob
// in memory until it's revoked. Scrolling a long feed used to pin every photo
// for the rest of the session — a few hundred images is enough memory to get
// a PWA killed on a phone. So the cache is reference-counted: entries in use
// by a mounted <img> are never touched, and once the cache outgrows its budget
// the least-recently-used *unreferenced* entries are revoked and dropped.
type Entry = { url: string; refs: number; usedAt: number };

const cache = new Map<string, Entry>();
// Display variants that 404'd this session — don't re-request them per mount.
const missingVariants = new Set<string>();

// Unreferenced images kept around for instant scroll-back. Roughly 10 screens
// of feed; well under what a phone will tolerate.
const IDLE_BUDGET = 60;

function acquire(key: string): Entry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  entry.refs++;
  entry.usedAt = Date.now();
  return entry;
}

function release(key: string) {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  entry.usedAt = Date.now();
  if (cache.size <= IDLE_BUDGET) return;

  const idle = [...cache.entries()]
    .filter(([, e]) => e.refs === 0)
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [k, e] of idle.slice(0, cache.size - IDLE_BUDGET)) {
    URL.revokeObjectURL(e.url);
    cache.delete(k);
  }
}

// With preferDisplay, tries the compressed photos/display/** copy first and
// falls back to the untouched original (pre-backfill photos, tiny images).
export function useAuthedImage(path: string | null | undefined, preferDisplay = false) {
  const [src, setSrc] = useState<string | null>(() => {
    if (!path) return null;
    const key = preferDisplay ? displayVariantPath(path) : path;
    return cache.get(key)?.url ?? cache.get(path)?.url ?? null;
  });
  // Which cache key this mount is holding a reference to, so it can let go.
  const held = useRef<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;

    const take = (key: string, url: string) => {
      if (held.current && held.current !== key) release(held.current);
      held.current = key;
      setSrc(url);
    };

    const candidates = preferDisplay ? [displayVariantPath(path), path] : [path];

    (async () => {
      for (const candidate of candidates) {
        if (missingVariants.has(candidate)) continue;
        // Re-check under acquire rather than trusting the render-time read:
        // an eviction may have run in between.
        const hit = acquire(candidate);
        if (hit) {
          if (cancelled) release(candidate);
          else take(candidate, hit.url);
          return;
        }
        try {
          const blob = await downloadFile(candidate);
          if (cancelled) return;
          // Another mount may have fetched the same photo while we waited.
          const raced = acquire(candidate);
          if (raced) {
            take(candidate, raced.url);
            return;
          }
          const url = URL.createObjectURL(blob);
          cache.set(candidate, { url, refs: 1, usedAt: Date.now() });
          take(candidate, url);
          return;
        } catch (e) {
          // Only a display copy that truly doesn't exist falls back to the
          // full-size original. A blip — offline, a timeout — must not pin
          // this card to the big file for the rest of the session; it shows
          // the placeholder and the next mount asks for the small copy again.
          if (candidate !== path) {
            if (!(e instanceof ApiError && e.status === 404)) break;
            missingVariants.add(candidate);
          }
        }
      }
      if (!cancelled) setSrc(null);
    })();

    return () => {
      cancelled = true;
      if (held.current) {
        release(held.current);
        held.current = null;
      }
    };
  }, [path, preferDisplay]);

  return src;
}
