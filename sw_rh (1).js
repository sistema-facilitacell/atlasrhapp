// ─── Atlas RH — Service Worker ────────────────────────────────────────────
// Estratégia: Cache-First + Stale-While-Revalidate
// • 1ª visita  → baixa da rede e cacheia
// • 2ª visita+ → entrega do cache IMEDIATAMENTE e atualiza em background
// • Offline    → sempre funciona com o cache
// ──────────────────────────────────────────────────────────────────────────

// ⚠ IMPORTANTE: incremente a versão sempre que fizer deploy de nova versão do HTML
// Ex: 'atlas-rh-v2', 'atlas-rh-v3' ...
const CACHE_VERSION = 'atlas-rh-v2';

// Arquivos pré-cacheados no install (shell do app)
const PRECACHE_ASSETS = [
  './index.html',
  // adicione outros assets estáticos aqui se houver:
  // './icone-192.png',
  // './icone-512.png',
  // './manifest_rh.json',
];

// ── Install: pré-cacheia o shell ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())  // ativa imediatamente sem esperar fechar abas
  );
});

// ── Activate: limpa caches antigos ────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // assume controle das abas abertas
  );
});

// ── Fetch: Stale-While-Revalidate ─────────────────────────────────────────
// Entrega cache na hora + atualiza em background silenciosamente
self.addEventListener('fetch', e => {
  // Só intercepta GET (ignora POST, etc.)
  if (e.request.method !== 'GET') return;

  // Ignora requisições externas (Firebase, Supabase, fonts, CDN)
  const url = new URL(e.request.url);
  const isLocal = url.origin === self.location.origin;
  if (!isLocal) return;

  e.respondWith(staleWhileRevalidate(e.request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  // Dispara busca na rede em background (não aguarda)
  const networkFetch = fetch(request)
    .then(response => {
      // Só cacheia respostas válidas
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());

        // Notifica abas abertas que há nova versão disponível
        if (request.url.endsWith('.html')) {
          notifyClientsNewVersion();
        }
      }
      return response;
    })
    .catch(() => null); // falha silenciosa se offline

  // Se tem cache → entrega AGORA (2ª visita é instantânea)
  // Se não tem cache → aguarda a rede (1ª visita normal)
  return cached || await networkFetch;
}

// ── Notifica abas sobre nova versão ───────────────────────────────────────
function notifyClientsNewVersion() {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => {
      client.postMessage({ type: 'SW_UPDATE_AVAILABLE' });
    });
  });
}
