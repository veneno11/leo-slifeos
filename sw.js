/* Leo's LifeOS service worker
   - Makes LifeOS install as a real app (no Chrome badge on the home screen icon)
   - Opens offline: the page, Tailwind, icons and fonts are cached after the first visit
   - Firestore, Gemini and creator avatars always go straight to the network */

const VERSION = 'v1';
const PREFIX = 'lifeos-';
const APP_CACHE = `${PREFIX}${VERSION}-app`;
const RUNTIME_CACHE = `${PREFIX}${VERSION}-runtime`;
const KEEP = [APP_CACHE, RUNTIME_CACHE];
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache =>
      Promise.allSettled(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Only clear LifeOS's own old caches, so other apps on the same site keep theirs
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && !KEEP.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isAppPage = url => url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') event.respondWith(networkFirstPage(req, url));
    else event.respondWith(staleWhileRevalidate(event, req, APP_CACHE));
    return;
  }
  const firebaseSdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (firebaseSdk || CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, req, RUNTIME_CACHE));
  }
  // Everything else (Firestore, Gemini, avatars) is network-only
});

async function networkFirstPage(req, url) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && isAppPage(url)) cache.put('./index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

async function staleWhileRevalidate(event, req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; })
    .catch(() => hit || Response.error());
  if (hit) { event.waitUntil(network); return hit; }
  return network;
}
