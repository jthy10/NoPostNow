"use client";

import { useCallback, useSyncExternalStore } from "react";
import { db, doc, getDoc, updateDoc } from "./store";

export const MASCOTS = ["cat", "duck", "crab", "dog"] as const;
export type MascotKind = (typeof MASCOTS)[number];

export const MASCOT_DETAILS: Record<
  MascotKind,
  { label: string; action: string; motion: string }
> = {
  cat: { label: "Cat", action: "walk", motion: "Walks" },
  duck: { label: "Duck", action: "waddle", motion: "Waddles" },
  crab: { label: "Crab", action: "scuttle", motion: "Scuttles" },
  dog: { label: "Dog", action: "run", motion: "Runs" },
};

export const DEFAULT_MASCOT: MascotKind = "cat";

const STORAGE_PREFIX = "nopostnow:mascot:";
const versions = new Map<string, number>();
const snapshots = new Map<string, MascotKind>();
const listeners = new Map<string, Set<() => void>>();

function isMascotKind(value: unknown): value is MascotKind {
  return typeof value === "string" && MASCOTS.includes(value as MascotKind);
}

function storageKey(uid: string) {
  return `${STORAGE_PREFIX}${uid}`;
}

function readCachedMascot(uid: string): MascotKind {
  try {
    const value = localStorage.getItem(storageKey(uid));
    return isMascotKind(value) ? value : DEFAULT_MASCOT;
  } catch {
    return DEFAULT_MASCOT;
  }
}

function getMascotSnapshot(uid: string): MascotKind {
  const current = snapshots.get(uid);
  if (current) return current;
  const cached = readCachedMascot(uid);
  snapshots.set(uid, cached);
  return cached;
}

function notifyMascot(uid: string, mascot: MascotKind) {
  snapshots.set(uid, mascot);
  versions.set(uid, (versions.get(uid) ?? 0) + 1);
  for (const listener of listeners.get(uid) ?? []) listener();
}

function publishMascot(uid: string, mascot: MascotKind) {
  try {
    localStorage.setItem(storageKey(uid), mascot);
  } catch {
    // The in-memory store still keeps this tab in sync when storage is blocked.
  }
  notifyMascot(uid, mascot);
}

export function useMascotPreference(uid?: string): MascotKind {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!uid) return () => {};

      let uidListeners = listeners.get(uid);
      if (!uidListeners) {
        uidListeners = new Set();
        listeners.set(uid, uidListeners);
      }
      uidListeners.add(onStoreChange);

      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey(uid) && isMascotKind(event.newValue)) {
          notifyMascot(uid, event.newValue);
        }
      };
      window.addEventListener("storage", onStorage);

      {
        const startedAtVersion = versions.get(uid) ?? 0;
        getDoc(doc(db, "users", uid))
          .then((snapshot) => {
            if ((versions.get(uid) ?? 0) !== startedAtVersion) return;
            const cloudMascot = snapshot.exists() ? snapshot.data().mascot : null;
            publishMascot(uid, isMascotKind(cloudMascot) ? cloudMascot : DEFAULT_MASCOT);
          })
          // Offline reads keep the most recent device choice.
          .catch(() => {});
      }

      return () => {
        uidListeners.delete(onStoreChange);
        if (uidListeners.size === 0) listeners.delete(uid);
        window.removeEventListener("storage", onStorage);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? getMascotSnapshot(uid) : DEFAULT_MASCOT),
    [uid]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MASCOT);
}

export async function saveMascotPreference(
  uid: string,
  mascot: MascotKind
) {
  const previous = getMascotSnapshot(uid);
  publishMascot(uid, mascot);
  try {
    await updateDoc(doc(db, "users", uid), { mascot });
  } catch (error) {
    publishMascot(uid, previous);
    throw error;
  }
}
