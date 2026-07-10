// sw.js — service worker for installable/offline PWA support.
// NETWORK-FIRST: always prefer fresh content when online (so deploys take
// effect immediately), falling back to cache only when offline. API requests
// are never intercepted.

const CACHE = "lt-v5"; // v5: PNG install icons; v4: purge cached error responses
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/auth.js",
  "/languages.js",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
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
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never touch API calls

  // Network-first: fetch fresh, update cache, fall back to cache when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Only cache good responses — a cached 404/500 would otherwise be
        // served as the offline fallback forever.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
