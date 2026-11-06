// Tests des pages propres de Fiftin Séjours (seopage.js). node functions/seopage.test.js
const assert = require("assert");
const sp = require("./seopage");

const TPL = '<!DOCTYPE html><html><head><title>Fiftin Séjours — Réservation directe</title>\n<meta name="description" content="Annuaire">\n</head>\n<body class="x">\n<div id="app"></div></body></html>';

// Adresses
assert.strictEqual(sp.slugify("Cottage en bordure de piscine — Été !"), "cottage-en-bordure-de-piscine-ete");
assert.strictEqual(sp.listingPath("abc123", "Chambre du Jardin"), "/sejours/h/abc123/chambre-du-jardin");
assert.strictEqual(sp.listingPath("abc123", ""), "/sejours/h/abc123");
assert.deepStrictEqual(sp.parsePath("/sejours/h/abc123/chambre"), {kind: "h", key: "abc123"});
assert.deepStrictEqual(sp.parsePath("/sejours/e/site_k2x9/la-ferme"), {kind: "e", key: "site_k2x9"});
assert.strictEqual(sp.parsePath("/sejours/h/"), null);
assert.strictEqual(sp.parsePath("/sejours/h/a%2Fb"), null, "barre oblique refusée");
assert.strictEqual(sp.parsePath("/sejours/h/%E0%A4%A"), null, "encodage invalide");
assert.strictEqual(sp.parsePath("/planning/"), null);

// Photo : version 1280 px d'abord, puis plein format, puis une location
assert.strictEqual(sp.coverOf({gallery: ["a.jpg"], galleryMid: ["a__mid.jpg"]}), "a__mid.jpg");
assert.strictEqual(sp.coverOf({gallery: ["a.jpg"]}), "a.jpg");
assert.strictEqual(sp.coverOf({gallery: [], units: [{gallery: ["u.jpg"]}]}), "u.jpg");
assert.strictEqual(sp.coverOf({}), null);

// Hébergement
const l = {name: "Cottage <piscine>", accomType: "gite", claim: "Au calme", desc: "Une longue description. ".repeat(20), city: "Le Fanost", regionName: "Pays de la Loire", lat: 47.1, lng: -1.5, gallery: ["https://x/a.jpg"]};
const m = sp.listingMeta("hs1", l, 120);
assert.strictEqual(m.title, "Cottage <piscine> — Le Fanost, Pays de la Loire | Fiftin Séjours");
assert.ok(m.description.startsWith("Gîte · Au calme. dès 120 € / nuit. Une longue"), m.description);
assert.ok(m.description.length <= 200);
assert.strictEqual(m.path, "/sejours/h/hs1/cottage-piscine");
const html = sp.injectPage(TPL, m);
assert.ok(html.includes("<title>Cottage &lt;piscine&gt; — Le Fanost, Pays de la Loire | Fiftin Séjours</title>"));
assert.ok(html.includes('<meta property="og:title" content="Cottage &lt;piscine&gt; — Le Fanost, Pays de la Loire">'));
assert.ok(html.includes('<meta property="og:image" content="https://x/a.jpg">'));
assert.ok(html.includes('<link rel="canonical" href="https://fiftin.fr/sejours/h/hs1/cottage-piscine">'));
assert.ok(html.includes('<meta name="description" content="Gîte · Au calme.'));
assert.ok(!html.includes('content="Annuaire"'), "description d'origine remplacée");
assert.ok(/<body class="x">\n<noscript><main[^]*<h1>Cottage &lt;piscine&gt;<\/h1>/.test(html), "résumé sans script");
const ld = JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html)[1]);
assert.strictEqual(ld["@type"], "LodgingBusiness");
assert.strictEqual(ld.name, "Cottage <piscine>");
assert.ok(!/<\/script>/.test(/application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]));
// Sans prix ni photo
const m2 = sp.listingMeta("x", {name: "Sans rien"}, null);
assert.strictEqual(m2.image, null);
assert.ok(!sp.injectPage(TPL, m2).includes("og:image"));
assert.ok(sp.injectPage(TPL, m2).includes('content="summary"'));

// Établissement
const members = [
  {id: "b0", price: 50, data: {name: "Sans lieu recopié"}},
  {id: "a", price: 150, data: {name: "Chambre A", city: "Le Fanost", place: {name: "La Ferme Fanost", kind: "maison", claim: "Une ferme", desc: "Présentation", gallery: ["p.jpg"]}}},
  {id: "b", price: 90, data: {name: "Chambre B"}},
];
const pm = sp.placeMeta("site_1", members);
assert.strictEqual(pm.title, "La Ferme Fanost — Le Fanost | Fiftin Séjours");
assert.ok(pm.description.startsWith("Maison d’hôtes · Une ferme. 3 hébergements, dès 50 € / nuit. Présentation"), pm.description);
assert.strictEqual(pm.image, "https://fiftin.fr/p.jpg", "adresse absolue");
assert.strictEqual(pm.path, "/sejours/e/site_1/la-ferme-fanost");
const ph = sp.injectPage(TPL, pm);
assert.ok(ph.includes('<li><a href="/sejours/h/b/chambre-b">Chambre B</a></li>'));

// Introuvable : gabarit inchangé, noindex
const nf = sp.injectPage(TPL, null);
assert.ok(nf.includes('<meta name="robots" content="noindex">'));
assert.ok(nf.includes("<title>Fiftin Séjours — Réservation directe</title>"));

// Plan du site : établissement seulement à partir de deux hébergements
const xml = sp.sitemapXml([
  {id: "a", name: "Chambre A", siteId: "s1", ownerUid: "u"}, {id: "b", name: "Chambre B", siteId: "s1", ownerUid: "u"},
  {id: "c", name: "Seule", siteId: "s2", ownerUid: "u"},
]);
assert.ok(xml.includes("<loc>https://fiftin.fr/sejours/h/a/chambre-a</loc>"));
assert.ok(xml.includes("<loc>https://fiftin.fr/sejours/e/s1</loc>"));
assert.ok(!xml.includes("/sejours/e/s2"));
assert.ok(xml.includes("<loc>https://fiftin.fr/planning/</loc>"));

console.log("seopage : tous les tests passent");
