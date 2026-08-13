/* Myth Studios till — offline shell.
   Cache-first: once the seller has opened it, the venue's wifi is irrelevant.
   VERSION is stamped by build.py, so a rebuilt catalog replaces the old cache. */
const VERSION = "20260814-012157";
const CACHE = "myth-till-" + VERSION;
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const save = (req, res) => {
  if (res && res.ok && res.type === "basic"){
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  // The page itself is network-first: a rebuilt catalogue must never be
  // hidden behind a stale cache. Falls straight back to the cached copy
  // the moment there's no signal.
  if (e.request.mode === "navigate" || e.request.destination === "document"){
    e.respondWith(
      fetch(e.request)
        .then(res => save(e.request, res))
        .catch(() => caches.match(e.request, { ignoreSearch: true })
          .then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // Icons and the manifest never change within a build — cache-first.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit || fetch(e.request).then(res => save(e.request, res)).catch(() => hit)
    )
  );
});
