// Service worker: offline-tolerant app shell + push notifications.
// Only pages and static assets are handled — API and photo requests pass
// straight through untouched (they carry the session and must never be cached).
const CACHE = "nopostnow-v3";

// Only a real, successful answer is worth keeping: a cached error page or a
// cached "sign in" would be served long after the problem went away.
function keep(request, res) {
  if (!res.ok || res.type !== "basic" || res.redirected) return;
  const copy = res.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Pages: network first (always fresh), cached shell if offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          keep(request, res);
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/"))
        )
    );
    return;
  }

  // Hashed build assets are immutable: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.match(/\.(png|ico)$/)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            keep(request, res);
            return res;
          })
      )
    );
  }
});

// --- Push notifications (wired up server-side in the notify stage) ---

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "New activity", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: data.url || "/" },
      // DM pushes share a per-thread tag so a burst of texts collapses into
      // one notification; renotify keeps each new one buzzing anyway.
      ...(data.tag ? { tag: data.tag, renotify: true } : {}),
    })
  );
});

// Tapping a notification lands on the thing itself: the payload's url is
// /p/{postId} for posts/comments/likes and /dm/{threadId} for texts.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin
  ).href;
  event.waitUntil(
    (async () => {
      const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
      // A window already showing the target just needs focus.
      const exact = wins.find((w) => w.url === url);
      if (exact) return exact.focus();
      for (const win of wins) {
        // Focus first — iOS drops navigate() on unfocused clients — and
        // await the navigation so a rejection falls through to openWindow
        // instead of leaving the app focused on the wrong page.
        try {
          await win.focus();
        } catch {}
        try {
          if (await win.navigate(url)) return;
        } catch {}
      }
      return clients.openWindow(url);
    })()
  );
});
