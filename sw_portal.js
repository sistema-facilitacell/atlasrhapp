/**
 * sw_portal.js — Service Worker do Portal do Colaborador — Atlas RH
 * Estratégia: Cache-First para o shell do app
 * Garante que o HTML carrega offline para o código de ponto (IndexedDB) funcionar
 *
 * ⚠ IMPORTANTE: atualize CACHE_VERSION a cada novo deploy do portal
 * Ex: 'atlas-portal-v2', 'atlas-portal-v3' ...
 *
 * ⚠ IMPORTANTE: atualize PORTAL_FILE com o nome exato do seu HTML no GitHub Pages
 */

const CACHE_VERSION = 'atlas-portal-v5';

// ── Nome exato do arquivo HTML no GitHub Pages ────────────────────────────
// Altere aqui se renomear o arquivo
const PORTAL_FILE = './portal.html';

// Shell pré-cacheado no install
const PRECACHE = [
  PORTAL_FILE,
  './',
  // './icone-192.png',   // descomente se tiver ícones no repo
  // './manifest.json',
];

// URLs externas que NUNCA devem ser interceptadas (Firebase, CDN, Cloudinary)
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

// ── Install: pré-cacheia o shell ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE))
      .catch(err => console.warn('[SW] Precache falhou (ignorado):', err))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpa caches antigos ────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => {
            console.log('[SW] Removendo cache antigo:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: Cache-First para assets locais, pass-through para externos ─────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // Deixa passar requisições externas (Firebase, CDN, etc.)
  if (PASSTHROUGH_PATTERNS.some(p => url.includes(p))) return;

  // Só intercepta requisições do mesmo origin
  const reqUrl = new URL(url);
  if (reqUrl.origin !== self.location.origin) return;

  // Navegação/HTML: SEMPRE tenta rede primeiro (garante que o app-shell
  // nunca fica preso numa versão antiga em cache). Cache só entra como
  // fallback se estiver offline. Isso é crítico pro portal — bug fix
  // (ex.: engine de biometria) tem que chegar no colaborador na hora,
  // não "algum dia" via revalidação em background.
  const isHtmlRequest = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || url.endsWith('.html')
    || url.endsWith('/');

  if (isHtmlRequest) {
    e.respondWith(networkFirst(e.request));
  } else {
    // Assets estáticos (imagens, fontes, etc.) continuam cache-first
    // com revalidação — não mudam com frequência, não há motivo pra
    // esperar rede toda vez.
    e.respondWith(cacheFirstWithRevalidate(e.request));
  }
});

// Network-First: tenta rede, cacheia a resposta, só cai pro cache se offline
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Sem internet → usa o que tiver em cache (permite bater ponto offline)
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

// Cache-First + revalidação em background (stale-while-revalidate)
async function cacheFirstWithRevalidate(request) {
  const cache  = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  // Atualiza em background sem bloquear
  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Tem cache → entrega agora (offline funciona, ponto pode ser registrado)
  // Sem cache → aguarda rede (primeira visita)
  return cached || await networkPromise;
}

// ── Push: notificação nativa (com app fechado) ────────────────────────────
self.addEventListener('push', e => {
  let d = {
    titulo: 'Atlas RH',
    corpo: 'Você tem uma nova notificação.',
    tipo: 'geral'
  };
  try {
    if (e.data) d = { ...d, ...e.data.json() };
  } catch (_) {
    if (e.data) d.corpo = e.data.text();
  }

  const fills = {
    holerite:               '0B1E35',
    justificativa_aprovada: '059669',
    justificativa_rejeitada:'DC2626',
    comunicado:             '2563EB',
    ponto:                  '059669',
    geral:                  'C9A84C',
  };
  const fill  = fills[d.tipo] || fills.geral;
  const icon  = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%23${fill}'/><text y='46' font-size='36' fill='white' font-family='Arial' x='14'>A</text></svg>`;

  e.waitUntil(
    self.registration.showNotification(d.titulo, {
      body: d.corpo,
      icon,
      badge: icon,
      tag: d.tipo || 'geral',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { tipo: d.tipo },
      actions: [{ action: 'ver', title: '👁 Ver agora' }],
    })
  );
});

// ── NotificationClick ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tipo = e.notification.data?.tipo || 'geral';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        for (const c of clients) {
          if ('focus' in c) {
            c.postMessage({ type: 'NOTIF_CLICK', tipo });
            return c.focus();
          }
        }
        return self.clients.openWindow('./');
      })
  );
});
