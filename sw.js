/* 쀼 가계부 서비스 워커: 앱 화면은 인터넷 먼저(실패하면 저장본), 아이콘·라이브러리는 저장본 먼저 */
const CACHE = 'ppyu-2026.11.23-1349';
const SHELL = ['./', 'index.html', 'fb.js?v=2026.11.23-1349', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'lib/xlsx.full.min.js', 'lib/firebase-app-compat.js', 'lib/firebase-auth-compat.js', 'lib/firebase-firestore-compat.js', 'lib/PretendardVariable.woff2'];
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
      e.respondWith(fetch(req, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put('index.html', c)); return r; }).catch(() => caches.match('index.html')));
      return;
    }
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return r; })));
    return;
  }
  if (LIB_HOSTS.includes(url.hostname) && !url.pathname.includes('/v1/')) {
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; })));
  }
});
