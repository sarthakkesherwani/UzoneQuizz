const CACHE = 'uzonequiz-v8';
const ASSETS = ['./', './index.html', './styles.css', './theme.css', './coding.css', './api.js', './app.js', './question-bank.js', './coding-harness.js', './coding-problems.js', './coding.js', './manifest.json'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).pathname.startsWith('/api/')) return; // live data — never cached
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(found => found || caches.match('./index.html'))));
});
