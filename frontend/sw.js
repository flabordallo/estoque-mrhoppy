// O nome do cache carrega a versão do app: cada release invalida automaticamente
// os assets antigos (o handler de "activate" apaga qualquer cache com nome diferente).
// Ao subir a versão em app.js/package.json, atualize também esta constante.
const CACHE_NAME = "estoque-bar-pwa-2.5.2";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./api.js","./manifest.webmanifest","./logo-mrhoppy.png",
  "./icon-192.png","./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Chamadas de API sempre vão à rede — nunca servir dado velho de cache.
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((r) => {
      const copy = r.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); return r;
    }).catch(() => caches.match("./index.html")))
  );
});
