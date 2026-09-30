const CACHE_PREFIX = "servizi-finops-";
const CACHE = `${CACHE_PREFIX}v2`;
const SHELL = ["/", "/styles.css", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];

async function refresh(request) {
  const response = await fetch(request);
  // Login redirects and authentication errors never enter the app cache.
  if (response.ok && !response.redirected && response.type !== "opaque") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of SHELL) {
      const response = await fetch(path, { cache: "reload" });
      if (!response.ok || response.redirected) throw new Error("Não foi possível instalar o aplicativo.");
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    try {
      return await refresh(event.request);
    } catch {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      return new Response("Sem conexão. Abra o aplicativo online para instalar os arquivos.", { status: 503 });
    }
  })());
});
