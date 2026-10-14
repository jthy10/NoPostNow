import webpush from "web-push";
import { inQuietHours } from "../lib/quiet-hours.ts";
import { config } from "./runtime.ts";
import { PUSH_SERVICE } from "./rules.ts";
import { getDoc, listCollection, removeDoc, type Data } from "./store.ts";

// Web push delivery. Sending runs entirely on the server, which is the only
// place that can see every member's devices and preferences.

export type PushKind = "post" | "comment" | "like" | "dm" | "daily";

export type PushPayload = { title: string; body: string; url: string; tag?: string };

export function pushConfigured(): boolean {
  const { publicKey, privateKey } = config().vapid;
  return Boolean(publicKey && privateKey);
}

function wants(prefs: Data | undefined, kind: PushKind): boolean {
  if (!prefs) return true; // no preferences saved: everything is on
  const field = kind === "daily" ? "daily" : `${kind}s`;
  if (prefs[field] === false) return false;
  return !inQuietHours(
    typeof prefs.quietStart === "number" ? prefs.quietStart : null,
    typeof prefs.quietEnd === "number" ? prefs.quietEnd : null,
    typeof prefs.tz === "string" ? prefs.tz : null,
    new Date(),
    config().timeZone
  );
}

// Everyone who has blocked this member, or been blocked by them. A push is
// unrecallable — an app can hide a row after the fact, but it cannot un-buzz
// a phone — so the filter has to live here.
export function blockedPairUids(uid: string): Set<string> {
  const hidden = new Set<string>();
  for (const doc of listCollection("blocks")) {
    const list = Array.isArray(doc.data.blocked) ? doc.data.blocked : [];
    if (doc.id === uid) {
      for (const other of list) if (typeof other === "string") hidden.add(other);
    } else if (list.includes(uid)) {
      hidden.add(doc.id);
    }
  }
  return hidden;
}

// Sends to every device of the chosen members (all members when `to` is
// omitted), honouring each one's preferences and quiet hours.
export async function sendPush(opts: {
  kind: PushKind;
  payload: PushPayload;
  to?: string[];
  exclude?: Set<string>;
  // Announcements from the admin ignore per-type preferences.
  ignorePrefs?: boolean;
}): Promise<{ sent: number; stale: number }> {
  if (!pushConfigured()) return { sent: 0, stale: 0 };
  const { vapid, publicUrl } = config();
  // web-push refuses any subject that is not an https: or mailto: address.
  const subject = [vapid.subject, publicUrl].find((s) => /^(https:|mailto:)/.test(s ?? ""));
  webpush.setVapidDetails(subject ?? "mailto:admin@localhost", vapid.publicKey, vapid.privateKey);

  const targets = opts.to ? new Set(opts.to) : null;
  const body = JSON.stringify(opts.payload);
  let sent = 0;
  let stale = 0;

  await Promise.allSettled(
    listCollection("pushSubscriptions").map(async (sub) => {
      const uid = typeof sub.data.uid === "string" ? sub.data.uid : "";
      if (!uid || (targets && !targets.has(uid)) || opts.exclude?.has(uid)) return;
      if (!opts.ignorePrefs && !wants(getDoc(`notifPrefs/${uid}`)?.data, opts.kind)) return;
      // Registered before endpoints were checked: never post anywhere else.
      if (!PUSH_SERVICE.test(String(sub.data.endpoint))) {
        removeDoc(sub.path);
        return;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: String(sub.data.endpoint),
            keys: { p256dh: String(sub.data.p256dh), auth: String(sub.data.auth) },
          },
          body,
          // A push service that never answers must not hold the request open.
          // A phone that was off doesn't get stale news when it comes back:
          // the daily reminder is only worth half an hour, the rest a day.
          { timeout: 10_000, TTL: opts.kind === "daily" ? 30 * 60 : 24 * 60 * 60 }
        );
        sent++;
      } catch (err) {
        // The push service says this device is gone for good.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          stale++;
          removeDoc(sub.path);
        }
      }
    })
  );
  return { sent, stale };
}
