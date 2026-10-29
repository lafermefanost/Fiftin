/* Prix « à partir de » d'une location Fiftin Planning, pour Fiftin Séjours.
 *
 * Règle (César) : prix minimum par nuit sur les 12 prochains mois, pour 1
 * personne, sans petit-déjeuner ni service ; et, par nombre de voyageurs,
 * le minimum pour ce nombre (affiché quand le voyageur filtre sur N
 * personnes). Saisons et week-ends compris (une période moins chère compte),
 * remise long séjour exclue (elle dépend de la durée du séjour).
 *
 * Mêmes calculs que l'outil (app/index.html : getRoomTariffForDate,
 * getRoomPriceForDate, tariffRules, seasonRuleFor, nightPriceDetail) —
 * vérifié par functions/pricing.test.js, qui exécute les fonctions de
 * l'outil elles-mêmes. Lecture seule : rien n'est jamais écrit dans Planning.
 */

function tariffForDate(room, ds) {
  const hist = (room && Array.isArray(room.tariffHistory)) ? room.tariffHistory : [];
  if (!hist.length) return null;
  const sorted = hist.slice().sort(function (a, b) { return String(a.from).localeCompare(String(b.from)); });
  let t = sorted[0];
  sorted.forEach(function (h) { if (h.from <= ds) t = h; });
  return t;
}

// Palier exact, sinon le plus proche en dessous, sinon le premier.
function priceForPax(t, pax) {
  const prices = (t && t.prices) || {};
  const keys = Object.keys(prices).map(Number).filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
  if (!keys.length) return 0;
  let price = prices[keys[0]];
  keys.forEach(function (k) { if (k <= pax) price = prices[k]; });
  return price;
}

function inYearPeriod(md, from, to) { return from <= to ? (md >= from && md <= to) : (md >= from || md <= to); }

function seasonRuleFor(t, ds) {
  const seasons = (t && Array.isArray(t.seasons)) ? t.seasons : [];
  const md = ds.slice(5);
  const per = seasons.find(function (x) { return x.type === "period" && x.from && x.to && inYearPeriod(md, x.from, x.to); });
  if (per) return per;
  const p = ds.split("-").map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  const we = seasons.find(function (x) { return x.type === "weekend"; });
  return we && (dow === 5 || dow === 6) ? we : null;
}

// Prix d'une nuit à la date ds, avant toute remise long séjour.
function nightPrice(room, ds, pax) {
  const t = tariffForDate(room, ds);
  if (!t) return null;
  const base = priceForPax(t, pax);
  if (base === "" || base == null || isNaN(+base)) return null;
  const rule = seasonRuleFor(t, ds);
  let pre = +base;
  if (rule) { const v = +rule.value || 0; pre = rule.mode === "eur" ? pre + v : pre * (1 + v / 100); }
  return Math.round(pre * 100) / 100;
}

function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

/* {from, byPax, capacity} ou null (location sans tarif : Séjours garde
 * alors le prix saisi par l'hôte). from = minimum pour 1 personne. */
function roomPricing(room, todayIso, days) {
  if (!room || !Array.isArray(room.tariffHistory) || !room.tariffHistory.length) return null;
  days = days || 365;
  const keys = [];
  room.tariffHistory.forEach(function (t) { Object.keys((t && t.prices) || {}).forEach(function (k) { if (!isNaN(+k)) keys.push(+k); }); });
  const capacity = Math.max(1, Math.min(30, +room.maxPersons || (keys.length ? Math.max.apply(null, keys) : 2)));
  const p = todayIso.split("-").map(Number);
  const start = Date.UTC(p[0], p[1] - 1, p[2]);
  const byPax = {};
  for (let pax = 1; pax <= capacity; pax++) {
    let min = null;
    for (let d = 0; d < days; d++) {
      const v = nightPrice(room, isoDay(start + d * 86400000), pax);
      if (v != null && v > 0 && (min == null || v < min)) min = v;
    }
    if (min != null) byPax[pax] = min;
  }
  if (byPax[1] == null) {
    const first = Object.keys(byPax).map(Number).sort(function (a, b) { return a - b; })[0];
    if (first == null) return null;
    for (let pax = 1; pax < first; pax++) byPax[pax] = byPax[first];
  }
  return {from: byPax[1], byPax: byPax, capacity: capacity};
}

module.exports = {tariffForDate, priceForPax, seasonRuleFor, nightPrice, roomPricing};
