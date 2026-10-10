// Service worker: permite abrir la app sin conexión (por ejemplo, en el supermercado).
// Estrategia: responde al instante desde la caché y actualiza en segundo plano.
// Al publicar cambios, sube CACHE para forzar la descarga de todos los archivos.
const CACHE = 'despensa-v4';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/logic.js',
  'js/recommendations.js',
  'js/scanner.js',
  'js/openfoodfacts.js',
  'js/vendor/zxing.min.js',
  'js/firebase-config.js',
  'js/cloud.js',
  'js/vendor/firebase/firebase-app.js',
  'js/vendor/firebase/firebase-auth.js',
  'js/vendor/firebase/firebase-firestore.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' evita la caché HTTP del navegador: así nunca se mezclan archivos de versiones distintas.
  const requests = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached ?? Response.error());
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
