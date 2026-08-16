const CACHE = "ledger-pro-pk-v3";
const SHELL = ["/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  // Always prefer the network for app navigations so a signed-in user never
  // gets an obsolete auth/business shell. Cache the latest successful page as
  // an offline fallback only.
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: "no-store" });
        const cache = await caches.open(CACHE);
        await cache.put("/", response.clone());
        return response;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
