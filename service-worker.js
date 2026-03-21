const CACHE = 'brainies-v2';
const FILES = [
  '/',
  '/index.html',
  '/lesson.html',
  '/dashboard.html',
  '/welcome.html',
  '/brainies-voice.js',
  '/manifest.json'
];

// ── INSTALL: cache all pages ──────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(FILES.map(u => new Request(u, { mode: 'no-cors' }))).catch(() => {})
    )
  );
  self.skipWaiting();
});

// ── ACTIVATE: remove old caches ───────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: serve cache first, then network ────────────────────────
self.addEventListener('fetch', e => {
  // API calls — try network, return offline JSON on failure
  if (e.request.url.includes(':5000')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'You are offline — some features need internet.' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // External CDN — try network first, ignore on fail
  if (e.request.url.includes('cdn.') || e.request.url.includes('fonts.')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('', { status: 200 }))
    );
    return;
  }

  // App pages — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          // Cache new successful responses
          if (res && res.status === 200 && e.request.method === 'GET') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
