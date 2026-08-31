// ─── Atlas RH — Service Worker ────────────────────────────────────────────
// Estratégia: Network-First para o HTML, Cache-First para assets estáticos.
// • HTML  → SEMPRE tenta a rede primeiro (garante que a versão nova do
//           sistema chega na hora — crítico para o bloqueio de licença
//           e correções). Cache só entra como fallback se estiver offline.
// • Assets (imagens, fontes) → cache-first com revalidação em background.
//
// IMPORTANTE: incremente CACHE_VERSION sempre que fizer deploy de nova
//   versao do HTML. Ex: 'atlas-rh-v3', 'atlas-rh-v4' ...
// ──────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'atlas-rh-v3';

const PRECACHE_ASSETS = [
  './index.html',
  './',
];

const PASSTHROUGH_PATTERNS = [
  'firestore.googleapis.com',
  'firebasestorage.googleapis.com',
  'firebase.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cloudinary.com',
  'supabase.co',
  'anthropic.com',
  'groq.com',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .catch(err => console.warn('[SW] Precache falhou (ignorado):', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (PASSTHROUGH_PATTERNS.some(p => url.includes(p))) return;
  const reqUrl = new URL(url);
  if (reqUrl.origin !== self.location.origin) return;

  const isHtmlRequest = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || url.endsWith('.html')
    || url.endsWith('/');

  if (isHtmlRequest) {
    e.respondWith(networkFirst(e.request));
  } else {
    e.respondWith(cacheFirstWithRevalidate(e.request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstWithRevalidate(request) {
  const cache  = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || await networkPromise;
}
