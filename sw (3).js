/* SmartFin service worker — cache offline (local-first) */
const V = 'sf-cache-v1';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

// pasang: precache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

// aktifkan: bersihkan cache lama, klaim klien
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // hanya tangani GET sesama origin; POST ke Apps Script & cross-origin dibiarkan
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // navigasi (HTML): network-first → fallback cache (biar update muncul saat online, offline pakai cache)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        const c = r.clone();
        caches.open(V).then(ca => ca.put('./index.html', c));
        return r;
      }).catch(() => caches.match('./index.html').then(m => m || caches.match('./')))
    );
    return;
  }

  // aset lain (ikon, manifest): cache-first
  e.respondWith(
    caches.match(req).then(m => m || fetch(req).then(r => {
      const c = r.clone();
      caches.open(V).then(ca => ca.put(req, c));
      return r;
    }))
  );
});
