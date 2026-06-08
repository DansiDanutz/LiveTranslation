// sw.js — minimal service worker for installable/offline PWA support.
// Caches the static app shell. API requests are NEVER cached.

const CACHE = "lt-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/auth.js",
  "/languages.js",
  "/manifest.json",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
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
  const url = new URL(event.request.url);
  // Only handle same-origin GETs; never intercept API calls.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first for the app shell, falling back to network (and caching it).
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached)
    )
  );
});
