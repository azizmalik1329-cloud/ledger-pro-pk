const VERSION = "ledger-pro-pk-v4-network-only";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Retire every old Ledger Pro cache. Authenticated app HTML/JS must always
    // come from the network so one device cannot keep running an obsolete app
    // shell after another deployment.
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();

    // When this v4 worker replaces an older cached worker, reload currently open
    // app tabs once. That immediately moves old mobile/desktop tabs onto the
    // current deployment without asking the user to clear browser storage.
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(clients.map(async client => {
      try {
        await client.navigate(client.url);
      } catch {
        // A closed/navigating client can disappear while the worker activates.
      }
    }));
  })());
});

// Intentionally no fetch handler: this service worker does not cache or serve
// application requests. The VERSION constant exists so future changes reliably
// trigger the browser's service-worker update lifecycle.
void VERSION;
