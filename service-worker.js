const CACHE = 'brainies-v3';

// Only cache actual app shell files — NOT external CDNs
// PERF: CDN intercepts added ~50-200ms per request via SW routing
const SHELL = [
  '/',
  '/index.html',
  '/lesson.html',
  '/dashboard.html',
  '/welcome.html',
  '/brainies-voice.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // Use no-cors for same-origin files, skip failures gracefully
      Promise.allSettled(SHELL.map(url =>
        c.add(new Request(url, { cache: 'reload' })).catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  const method = e.request.method;

  // Only handle GET requests
  if (method !== 'GET') return;

  // PERF: Never intercept external CDN requests — let browser handle them natively
  // Intercepting fonts.googleapis.com, cdn.jsdelivr.net etc adds latency
  if (url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com') ||
      url.includes('cdn.jsdelivr.net') ||
      url.includes('cdnfonts.com') ||
      url.includes('api.mymemory') ||
      url.includes('api-inference.huggingface') ||
      url.includes('deepai.org')) {
    return; // let browser handle directly — no SW involvement
  }

  // API calls to Flask backend — network only, offline fallback JSON
  if (url.includes(':5000') || url.includes('/simplify') || url.includes('/translate') ||
      url.includes('/save-') || url.includes('/get-') || url.includes('/dashboard/') ||
      url.includes('/teacher-login') || url.includes('/health')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'You are offline.' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // App shell — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
