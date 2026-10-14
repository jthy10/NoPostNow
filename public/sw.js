// Service worker: offline-tolerant app shell + push notifications.
// Only pages and static assets are handled — API and photo requests pass
// straight through untouched (they carry the session and must never be cached).
//
// Two caches, each with a size cap: pages (one shell per route visited) and
// static files (hashed build chunks pile up across updates otherwise). Both
// names carry a version; bumping it on activate drops everything older.
const PAGES = "nopostnow-pages-v4";
const STATIC = "nopostnow-static-v4";
const MAX_PAGES = 40;
const MAX_STATIC = 300;

// Only a real, successful answer is worth keeping: a cached error page or a
// cached "sign in" would be served long after the problem went away.
const keepable = (res) => res && res.ok && res.type === "basic" && !res.redirected;

// Caches list their entries oldest-first, so trimming from the front drops
// whatever has gone longest without being refreshed. "/" is never dropped:
// it's the shell every offline page falls back to.
async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const extra = keys.length - max;
  if (extra <= 0) return;
  const drop = keys.filter((k) => new URL(k.url).pathname !== "/").slice(0, extra);
  await Promise.all(drop.map((k) => cache.delete(k)));
}

async function store(name, max, request, res) {
  if (!keepable(res)) return;
  const cache = await caches.open(name);
  // Re-adding moves an entry to the back, so trim drops the stale ones.
  await cache.delete(request);
  await cache.put(request, res);
  await trim(name, max);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(["/"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== PAGES && k !== STATIC).map((k) => caches.delete(k)))
      )
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
          event.waitUntil(store(PAGES, MAX_PAGES, request, res.clone()));
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/"))
        )
    );
    return;
  }

  // Hashed build assets are immutable: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            event.waitUntil(store(STATIC, MAX_STATIC, request, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  // Icons keep the same name when they're redrawn, so they can't be cache-
  // first for good: show the cached one at once, and fetch the current one
  // behind it for next time.
  if (url.pathname.match(/\.(png|ico)$/)) {
    const refresh = fetch(request).then((res) => {
      event.waitUntil(store(STATIC, MAX_STATIC, request, res.clone()));
      return res;
    });
    event.waitUntil(refresh.catch(() => {}));
    event.respondWith(caches.match(request).then((hit) => hit || refresh));
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
  // Only ever this app: a payload url like "//example.com" resolves to
  // another site, and a notification must never be a link out.
  let target;
  try {
    target = new URL(
      (event.notification.data && event.notification.data.url) || "/",
      self.location.origin
    );
  } catch {
    target = null;
  }
  const url =
    target && target.origin === self.location.origin ? target.href : `${self.location.origin}/`;
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
