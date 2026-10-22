/* Fiftin — service worker de l'app de planning (portée : /app/).
 *
 * But : que l'app s'ouvre même sans réseau, en affichant la dernière copie
 * du planning gardée sur l'appareil (localStorage, voir persist() dans
 * index.html). Sans lui, iOS/Safari recharge la page depuis Internet à
 * chaque ouverture de l'icône et affiche une erreur hors connexion.
 *
 * Stratégies :
 *  - page de l'app (navigation) : réseau d'abord — chaque mise en ligne est
 *    reçue dès qu'il y a du réseau — puis copie gardée si le réseau échoue
 *    ou ne répond pas dans les 6 s ;
 *  - SDK Firebase (URL versionnées), polices, jsPDF, logo : copie gardée
 *    d'abord, réseau sinon (et mise en copie) ;
 *  - tout le reste (Firestore, Auth, Cloud Functions…) : jamais intercepté,
 *    jamais mis en cache — ce sont des données vivantes.
 *
 * Changer CACHE_VERSION force le remplacement complet des copies gardées. */
const CACHE_VERSION = "fiftin-app-v2";
const PAGE_URL = new URL("./index.html", self.location).href;
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "../assets/logo-fiftin-mark-glass.png",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions-compat.js",
];
const STATIC_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Un fichier qui échoue ne doit pas empêcher l'installation des autres.
    await Promise.all(PRECACHE.map((u) => {
      const req = new Request(u, u.startsWith("http") ? {mode: "no-cors"} : {});
      return fetch(req).then((res) => cache.put(req, res)).catch(() => {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("fiftin-app-") && k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isStatic(url) {
  if (STATIC_HOSTS.indexOf(url.hostname) !== -1) {
    // Seuls les fichiers statiques de ces hôtes (pas d'API Google).
    return url.hostname !== "www.gstatic.com" || url.pathname.indexOf("/firebasejs/") === 0;
  }
  // Images/icônes de /assets/ seulement : pas les vidéos (lourdes, et
  // servies par plages d'octets — réponses 206 que le cache n'accepte pas).
  return url.origin === self.location.origin && /\/assets\//.test(url.pathname) && !/\.(mp4|webm|mov)$/i.test(url.pathname);
}

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
    ]);
    if (res && res.ok) cache.put(PAGE_URL, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(PAGE_URL) || await cache.match(request, {ignoreSearch: true});
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, {ignoreVary: true});
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(networkFirstPage(req));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(cacheFirst(req));
  }
});
