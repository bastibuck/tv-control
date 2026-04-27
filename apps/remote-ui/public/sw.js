const APP_SHELL_CACHE = "tv-control-app-shell-v1";
const STATIC_CACHE = "tv-control-static-v1";
const WEBSOCKET_PATH = "/ws";
const APP_SHELL_ASSETS = [
  "/",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

async function resolveAppShellAssets() {
  const response = await fetch("/", { cache: "no-cache" });
  const html = await response.text();
  const assetMatches = Array.from(
    html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g),
    (match) => match[1],
  );
  return [...new Set([...APP_SHELL_ASSETS, ...assetMatches])];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    resolveAppShellAssets()
      .catch(() => APP_SHELL_ASSETS)
      .then((assets) =>
        caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(assets)),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_SHELL_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === WEBSOCKET_PATH) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(APP_SHELL_CACHE);
            await cache.put("/", response.clone());
          }

          return response;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cachedResponse) =>
        cachedResponse ??
        fetch(request)
          .then(async (response) => {
            if (response.ok) {
              const cache = await caches.open(STATIC_CACHE);
              await cache.put(request, response.clone());
            }

            return response;
          })
          .catch(() => Response.error()),
    ),
  );
});
