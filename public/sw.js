/* Service Worker «ВидеоПеревод»
   Стратегия:
   - навигация: только сеть; при офлайне — /offline.html из кэша
   - /demo/* медиа: cache-first с обновлением в фоне (демо работает офлайн)
   - иконки/манифест: cache-first
   - /api/* и всё остальное: не перехватываем (HTML и чанки не кэшируем —
     приложение требует сеть для перевода, а кэш dev-сборки быстро устаревает)
*/

const VERSION = "videoperevod-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const MEDIA_CACHE = `${VERSION}-media`;

const SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/demo/demo.srt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.allSettled(SHELL_ASSETS.map((u) => cache.add(u)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API не трогаем никогда — переводу нужна живая сеть
  if (url.pathname.startsWith("/api/")) return;

  // навигация по страницам: сеть, при сбое — офлайн-заглушка
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .open(SHELL_CACHE)
          .then((cache) => cache.match("/offline.html"))
          .then((resp) => resp || Response.error())
      )
    );
    return;
  }

  // демо-медиа: cache-first + фоновое обновление
  if (url.pathname.startsWith("/demo/")) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })
    );
    return;
  }

  // иконки и манифест: cache-first
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.png" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const resp = await fetch(req);
        if (resp && resp.status === 200) cache.put(req, resp.clone());
        return resp;
      })
    );
  }
});
