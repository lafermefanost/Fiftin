/* Pages propres de Fiftin Séjours (demande de César) : un hébergement
 * (/sejours/h/<id>/<nom>) ou un établissement (/sejours/e/<siteId>/<nom>)
 * servi avec SON titre, sa description et sa photo dans le HTML même,
 * pour les aperçus de liens (WhatsApp, iMessage, Messenger…, qui
 * n'exécutent pas le script de la page) et pour Google. La page reste
 * l'application Séjours (sejours/index.html) : seules les balises de
 * l'en-tête changent, et un résumé lisible sans script est ajouté.
 * Fonctions pures, testées par seopage.test.js ; lecture Firestore et
 * réponse HTTP dans index.js (sejoursPage, sitemap). */

const SITE = "https://fiftin.fr";

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function slugify(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}
function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s;
}
function listingPath(id, name) { const sl = slugify(name); return "/sejours/h/" + encodeURIComponent(id) + (sl ? "/" + sl : ""); }
function placePath(siteId, name) { const sl = slugify(name); return "/sejours/e/" + encodeURIComponent(siteId) + (sl ? "/" + sl : ""); }

// Mêmes libellés que sejours/index.html (ACCOM_TYPES, PLACE_KINDS).
const TYPE_LABELS = {chambre: "Chambre d'hôtes", gite: "Gîte"};
const PLACE_KINDS = {maison: "Maison d’hôtes", hotel: "Petit hôtel", domaine: "Domaine de gîtes", ferme: "Ferme", insolite: "Hébergements insolites"};

/* Photo d'aperçu : la plus légère qui existe — miniature 480 px
 * (galleryThumb), sinon version 1280 px (galleryMid), sinon le plein format ;
 * première photo de l'annonce, sinon d'une location. WhatsApp fabrique
 * l'aperçu sur le téléphone de l'expéditeur et abandonne la photo si elle
 * est lourde ou lente (constaté avec la version 1280 px : une fois sur deux). */
function lightest(o) {
  if (!o || !o.gallery || !o.gallery.length || !o.gallery[0]) return null;
  const ok = function (v) { return typeof v === "string" && v ? v : null; };
  return ok(o.galleryThumb && o.galleryThumb[0]) || ok(o.galleryMid && o.galleryMid[0]) || o.gallery[0];
}
function coverOf(l) {
  const pick = lightest;
  const own = pick(l);
  if (own) return own;
  const units = (l && l.units) || [];
  for (let i = 0; i < units.length; i++) { const u = pick(units[i]); if (u) return u; }
  return null;
}
// Aperçus : adresse absolue obligatoire (photos hébergées ailleurs déjà absolues).
function absUrl(u) { return !u ? null : /^https?:\/\//.test(u) ? u : SITE + "/" + String(u).replace(/^\/+/, ""); }
function placeOf(l) { return (l && l.place) || {}; }
function whereOf(l) { return [l.city, l.regionName || l.deptName].filter(Boolean).join(", ") || l.region || ""; }
// Phrases jointes par « . » : sans la ponctuation finale de chacune (pas de « forêt.. dès »).
function sentences(parts) {
  return parts.filter(Boolean).map(function (x) { return String(x).trim().replace(/[\s.!…;:,]+$/, ""); }).filter(Boolean).join(". ");
}
function priceText(p) { return typeof p === "number" && p > 0 ? "dès " + Math.round(p) + " € / nuit" : ""; }

/* Méta d'un hébergement : l = document listings/{id}, price = prix public
 * de l'index (listingIndex) quand il est connu. */
function listingMeta(id, l, price) {
  const type = TYPE_LABELS[l.accomType] || "";
  const where = whereOf(l);
  const title = (l.name || "Hébergement") + (where ? " — " + where : "") + " | Fiftin Séjours";
  const lead = [type, l.claim].filter(Boolean).join(" · ");
  const pt = priceText(price);
  const description = clip(sentences([lead, pt, l.desc]), 200);
  const image = absUrl(coverOf(l));
  return {
    title: title, description: description, image: image, path: listingPath(id, l.name),
    heading: l.name || "Hébergement", sub: [type, where, pt].filter(Boolean).join(" · "), body: clip(l.desc, 600),
    jsonld: {"@context": "https://schema.org", "@type": "LodgingBusiness", name: l.name || "", description: clip(l.desc || l.claim, 300),
      image: image || undefined, address: where ? {"@type": "PostalAddress", addressLocality: l.city || undefined, addressRegion: l.regionName || l.deptName || undefined, addressCountry: "FR"} : undefined,
      geo: (typeof l.lat === "number" && typeof l.lng === "number") ? {"@type": "GeoCoordinates", latitude: l.lat, longitude: l.lng} : undefined,
      priceRange: pt || undefined, url: SITE + listingPath(id, l.name)},
  };
}

/* Méta d'un établissement : members = documents des hébergements en ligne
 * ({id, data, price}), le premier sert de référence pour le lieu. */
function placeMeta(siteId, members) {
  // Lieu (nom, photos, présentation) recopié sur chaque hébergement : on le
  // lit sur le premier qui le porte.
  const ref = (members.filter(function (m) { return m.data.place && m.data.place.name; })[0] || members[0]).data;
  const place = placeOf(ref);
  const name = place.name || ref.name || "Établissement";
  const kind = PLACE_KINDS[place.kind] || "";
  const where = whereOf(ref);
  const prices = members.map(function (m) { return m.price; }).filter(function (p) { return typeof p === "number" && p > 0; });
  const pt = prices.length ? priceText(Math.min.apply(null, prices)) : "";
  const n = members.length + " hébergement" + (members.length > 1 ? "s" : "");
  const title = name + (where ? " — " + where : "") + " | Fiftin Séjours";
  const description = clip(sentences([[kind, place.claim].filter(Boolean).join(" · "), n + (pt ? ", " + pt : ""), place.desc || ref.desc]), 200);
  const image = absUrl(lightest(place) || coverOf(ref));
  return {
    title: title, description: description, image: image, path: placePath(siteId, name),
    heading: name, sub: [kind, where, n, pt].filter(Boolean).join(" · "), body: clip(place.desc || ref.desc, 600),
    items: members.map(function (m) { return {name: m.data.name || "", path: listingPath(m.id, m.data.name)}; }),
    jsonld: {"@context": "https://schema.org", "@type": "LodgingBusiness", name: name, description: clip(place.desc || place.claim || ref.desc, 300), image: image || undefined,
      address: where ? {"@type": "PostalAddress", addressLocality: ref.city || undefined, addressRegion: ref.regionName || ref.deptName || undefined, addressCountry: "FR"} : undefined,
      priceRange: pt || undefined, url: SITE + placePath(siteId, name)},
  };
}

/* Insère la méta dans le gabarit sejours/index.html : <title>, description,
 * Open Graph / Twitter, adresse canonique, JSON-LD, et un résumé lisible
 * sans script (<noscript>). meta = null : page introuvable (noindex). */
function injectPage(template, meta) {
  let html = String(template);
  if (!meta) {
    return html.replace("</head>", '<meta name="robots" content="noindex">\n</head>');
  }
  const url = SITE + meta.path;
  const tags = [
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Fiftin Séjours">',
    '<meta property="og:locale" content="fr_FR">',
    '<meta property="og:title" content="' + esc(meta.title.replace(/ \| Fiftin Séjours$/, "")) + '">',
    '<meta property="og:description" content="' + esc(meta.description) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    meta.image ? '<meta property="og:image" content="' + esc(meta.image) + '">' : "",
    '<meta name="twitter:card" content="' + (meta.image ? "summary_large_image" : "summary") + '">',
    '<script type="application/ld+json">' + JSON.stringify(meta.jsonld).replace(/</g, "\\u003c") + "</script>",
  ].filter(Boolean).join("\n");
  html = html.replace(/<title>[^<]*<\/title>/, "<title>" + esc(meta.title) + "</title>");
  html = html.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(meta.description) + '">');
  html = html.replace("</head>", tags + "\n</head>");
  const summary = '<noscript><main style="padding:24px;font-family:sans-serif"><h1>' + esc(meta.heading) + "</h1>" +
    (meta.sub ? "<p>" + esc(meta.sub) + "</p>" : "") + (meta.body ? "<p>" + esc(meta.body) + "</p>" : "") +
    (meta.items ? "<ul>" + meta.items.map(function (it) { return '<li><a href="' + esc(it.path) + '">' + esc(it.name) + "</a></li>"; }).join("") + "</ul>" : "") +
    '<p><a href="/sejours/">Tous les hébergements de Fiftin Séjours</a></p></main></noscript>';
  html = html.replace(/<body([^>]*)>/, "<body$1>\n" + summary);
  return html;
}

/* Plan du site : pages fixes, chaque hébergement en ligne et chaque
 * établissement (au moins deux hébergements en ligne). entries = index
 * public [{id, name, siteId, ownerUid}]. */
function sitemapXml(entries) {
  const urls = ["/", "/sejours/", "/planning/"];
  const sites = {};
  entries.forEach(function (e) {
    urls.push(listingPath(e.id, e.name));
    if (e.siteId) { const k = (e.ownerUid || "") + "|" + e.siteId; (sites[k] = sites[k] || {siteId: e.siteId, n: 0}).n++; }
  });
  Object.keys(sites).forEach(function (k) { if (sites[k].n >= 2) urls.push(placePath(sites[k].siteId, "")); });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(function (u) { return "  <url><loc>" + esc(SITE + u) + "</loc></url>"; }).join("\n") + "\n</urlset>\n";
}

/* /sejours/h/<id>/… ou /sejours/e/<siteId>/… → {kind, key}. */
function parsePath(p) {
  const m = /^\/sejours\/(h|e)\/([^/?#]+)/.exec(String(p || ""));
  if (!m) return null;
  let key;
  try { key = decodeURIComponent(m[2]); } catch (e) { return null; }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) return null;
  return {kind: m[1], key: key};
}

module.exports = {esc, slugify, clip, listingPath, placePath, coverOf, listingMeta, placeMeta, injectPage, sitemapXml, parsePath};
