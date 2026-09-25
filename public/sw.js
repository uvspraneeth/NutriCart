// NutriCart service worker: just enough to be installable and to show a friendly page when offline.
// Pages always come from the network (the catalogue and stock change constantly); nothing under
// /api or /admin is ever cached.
const CACHE = 'nutricart-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE_URL, '/icons/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.mode !== 'navigate') return
  const path = new URL(request.url).pathname
  if (path.startsWith('/api') || path.startsWith('/admin')) return
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
})
