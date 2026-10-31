/* Réparation du catalogue des consommations d'un compte (demande de César,
 * 31/10/2026) : des changements de prix non datés ont été appliqués à
 * toutes les ventes passées. On compare le catalogue AVANT (relu à un
 * instant précis grâce à la récupération Firestore) au catalogue actuel et
 * on rétablit, pour chaque article dont le prix passé a changé :
 *   historique d'avant (ou son prix d'alors)  +  nouveau prix daté du jour
 *   d'effet. Rien d'autre n'est touché (nom, emoji, catégorie, articles
 *   ajoutés depuis, réservations…). Calcul pur, testé par
 *   catalog-repair.test.js. */

// Même règle que catalogPrice() de app/index.html.
function priceAt(item, ds) {
  const h = item && item.priceHistory;
  if (!Array.isArray(h) || !h.length) return item ? (+item.price || 0) : 0;
  let cur = h[0];
  h.forEach(function (v) { if (v.from <= ds) cur = v; });
  return +cur.price || 0;
}

function dayBefore(ds) {
  const d = new Date(ds + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Quantités vendues avant `before` (réservations, événements, extérieurs).
function soldQty(data, id, before) {
  let n = 0;
  const inDays = function (x) {
    Object.keys(x || {}).forEach(function (ds) { if (ds < before && x[ds] && x[ds][id] > 0) n += +x[ds][id]; });
  };
  (data.bookings || []).forEach(function (b) { if (b) inDays(b.extras); });
  (data.events || []).forEach(function (e) { if (e) inDays(e.extras); });
  const ext = data.extDiners || {};
  Object.keys(ext).forEach(function (ds) {
    if (ds >= before) return;
    (ext[ds] || []).forEach(function (e) { if (e && e.extras && e.extras[id] > 0) n += +e.extras[id]; });
  });
  return n;
}

/* before, now : documents accounts/{uid} (avant / actuel).
 * effective   : jour d'effet des nouveaux prix (AAAA-MM-JJ).
 * Retour : {rows (rapport), catalog (catalogue réparé), changes}. */
function planRepair(before, now, effective) {
  const prev = (before && before.catalog) || [];
  const cur = (now && now.catalog) || [];
  const lastPast = dayBefore(effective);
  const rows = [];
  let changes = 0;
  const catalog = cur.map(function (item) {
    const b = prev.find(function (x) { return x && x.id === item.id; });
    const row = {
      id: item.id,
      name: (item.emoji ? item.emoji + " " : "") + (item.name || item.id),
      before: b ? priceAt(b, lastPast) : null,
      pastNow: priceAt(item, lastPast),
      price: +item.price || 0,
      dated: Array.isArray(item.priceHistory) && item.priceHistory.length > 0,
      sold: soldQty(now || {}, item.id, effective),
      action: "",
    };
    if (!b) { row.action = "nouvel article, inchangé"; rows.push(row); return item; }
    if (row.pastNow === row.before) {
      row.action = row.price === row.before ? "prix inchangé" : "déjà daté correctement";
      rows.push(row); return item;
    }
    // Historique d'avant, limité aux versions antérieures au jour d'effet.
    let hist = Array.isArray(b.priceHistory) && b.priceHistory.length
      ? b.priceHistory.filter(function (v) { return v && v.from < effective; }).map(function (v) { return {from: v.from, price: +v.price || 0}; })
      : [];
    if (!hist.length) hist = [{from: "2000-01-01", price: +b.price || 0}];
    hist.push({from: effective, price: row.price});
    // Versions déjà datées après le jour d'effet : gardées.
    (Array.isArray(item.priceHistory) ? item.priceHistory : []).forEach(function (v) {
      if (v && v.from > effective) hist.push({from: v.from, price: +v.price || 0});
    });
    row.action = "réparé : " + row.before + " € avant le " + effective + ", " + row.price + " € ensuite";
    changes++;
    rows.push(row);
    return Object.assign({}, item, {priceHistory: hist});
  });
  prev.forEach(function (b) {
    if (b && !cur.some(function (x) { return x && x.id === b.id; })) {
      rows.push({id: b.id, name: (b.emoji ? b.emoji + " " : "") + (b.name || b.id), before: priceAt(b, lastPast), pastNow: null, price: null, dated: false, sold: soldQty(now || {}, b.id, effective), action: "supprimé depuis (non réparé)"});
    }
  });
  return {rows: rows, catalog: catalog, changes: changes};
}

module.exports = {priceAt, soldQty, planRepair, dayBefore};
