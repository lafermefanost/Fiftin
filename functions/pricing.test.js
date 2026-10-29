/* Parité du calcul des prix (functions/pricing.js) avec l'outil Planning :
 * les fonctions de app/index.html sont extraites telles quelles et exécutées
 * ici, puis comparées jour par jour et nombre de personnes par nombre de
 * personnes sur 12 mois. Lancé par le workflow des fonctions avant tout
 * déploiement (comme ical.test.js). */
const fs = require("fs");
const path = require("path");
const pricing = require("./pricing");

const appSrc = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
function grab(name) {
  const i = appSrc.indexOf("function " + name + "(");
  if (i < 0) throw new Error("fonction absente de l'outil : " + name);
  let d = 0, j = appSrc.indexOf("{", i);
  for (;; j++) { if (appSrc[j] === "{") d++; if (appSrc[j] === "}" && --d === 0) break; }
  return appSrc.slice(i, j + 1);
}
const app = new Function("ROOMS", [
  "defaultRoomPrices", "getRoomTariffForDate", "getRoomPriceForDate", "tariffRules", "inYearPeriod", "seasonRuleFor", "longStayRuleFor", "nightPriceDetail",
].map(grab).join("\n") + "\nreturn {getRoomTariffForDate, getRoomPriceForDate, tariffRules, nightPriceDetail};");

const rooms = [
  {id: "simple", maxPersons: 2, tariffHistory: [{from: "2000-01-01", prices: {1: 80, 2: 95}}]},
  {id: "paliers", maxPersons: 6, tariffHistory: [{from: "2000-01-01", prices: {2: "90", 4: "120", 6: "150"}}]},
  {id: "saisons", maxPersons: 4, tariffHistory: [{from: "2000-01-01", prices: {1: 100, 2: 110, 4: 140},
    seasons: [{type: "weekend", mode: "pct", value: 20}, {type: "period", label: "Été", from: "07-01", to: "08-31", mode: "eur", value: 30},
      {type: "period", label: "Hiver", from: "11-15", to: "02-15", mode: "pct", value: -15}]}]},
  {id: "versions", maxPersons: 3, tariffHistory: [{from: "2000-01-01", prices: {1: 70, 3: 100}},
    {from: "2027-03-01", prices: {1: 65, 3: 95}, seasons: [{type: "weekend", mode: "eur", value: 10}]}, {from: "2099-01-01", prices: {1: 1}}]},
  {id: "longsejour", maxPersons: 2, tariffHistory: [{from: "2000-01-01", prices: {1: 90, 2: 100}, longStay: [{minNights: 7, pct: 10}]}]},
];
const A = app(rooms);
const today = "2026-10-29";
let ok = 0, ko = 0;
rooms.forEach(function (room) {
  const got = pricing.roomPricing(room, today, 365);
  for (let pax = 1; pax <= room.maxPersons; pax++) {
    let min = null;
    for (let d = 0; d < 365; d++) {
      const ds = new Date(Date.UTC(2026, 9, 29) + d * 86400000).toISOString().slice(0, 10);
      // Réservation d'une nuit arrivant ce jour-là : prix avant remise (pre).
      const t = A.getRoomTariffForDate(room.id, ds);
      const v = A.nightPriceDetail(+A.getRoomPriceForDate(room.id, ds, pax), A.tariffRules(t), ds, 1).pre;
      const mine = pricing.nightPrice(room, ds, pax);
      if (mine !== v) { ko++; console.log("ÉCHEC " + room.id + " " + ds + " " + pax + " pers. : outil " + v + " / Séjours " + mine); }
      if (v > 0 && (min == null || v < min)) min = v;
    }
    if (got.byPax[pax] === min) ok++; else { ko++; console.log("ÉCHEC minimum " + room.id + " " + pax + " pers. : outil " + min + " / Séjours " + got.byPax[pax]); }
  }
});
// Cas attendus, lisibles
const s = pricing.roomPricing(rooms[2], today, 365);
if (s.from === 85) ok++; else { ko++; console.log("ÉCHEC saisons : à partir de attendu 85 (100 − 15 % en hiver), obtenu " + s.from); }
if (pricing.roomPricing({maxPersons: 2}, today, 365) === null) ok++; else { ko++; console.log("ÉCHEC location sans tarif"); }
if (pricing.roomPricing(rooms[3], today, 365).from === 65) ok++; else { ko++; console.log("ÉCHEC version à venir dans les 12 mois (65)"); }
console.log("pricing.test.js : " + ok + " OK, " + ko + " échec(s)");
if (ko) process.exit(1);
