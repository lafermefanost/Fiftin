/* node scripts/catalog-repair.test.js */
const assert = require("assert");
const {planRepair, priceAt} = require("./catalog-repair-lib");

const EFF = "2026-10-31";
const before = {catalog: [
  {id: "cafe", name: "Café", price: 2},
  {id: "vin", name: "Vin", price: 20, priceHistory: [{from: "2000-01-01", price: 18}, {from: "2026-10-25", price: 20}]},
  {id: "jus", name: "Jus", price: 3},
  {id: "gone", name: "Ancien", price: 5},
]};
const now = {
  catalog: [
    {id: "cafe", name: "Café", price: 2.5},                                   // changé sans date → à réparer
    {id: "vin", name: "Vin", price: 24, priceHistory: [{from: "2000-01-01", price: 24}]}, // historique écrasé → à réparer
    {id: "jus", name: "Jus", price: 4, priceHistory: [{from: "2000-01-01", price: 3}, {from: EFF, price: 4}]}, // déjà daté
    {id: "new", name: "Nouveau", price: 9},                                   // ajouté depuis
  ],
  bookings: [{extras: {"2026-10-10": {cafe: 2, vin: 1}, "2026-10-31": {cafe: 1}}}],
  events: [{extras: {"2026-10-20": {jus: 3}}}],
  extDiners: {"2026-10-12": [{extras: {cafe: 1}}]},
};
const p = planRepair(before, now, EFF);
assert.strictEqual(p.changes, 2);
const cafe = p.catalog.find((c) => c.id === "cafe");
assert.deepStrictEqual(cafe.priceHistory, [{from: "2000-01-01", price: 2}, {from: EFF, price: 2.5}]);
assert.strictEqual(cafe.price, 2.5);
assert.strictEqual(priceAt(cafe, "2026-10-10"), 2);
assert.strictEqual(priceAt(cafe, EFF), 2.5);
const vin = p.catalog.find((c) => c.id === "vin");
assert.deepStrictEqual(vin.priceHistory, [{from: "2000-01-01", price: 18}, {from: "2026-10-25", price: 20}, {from: EFF, price: 24}]);
assert.strictEqual(priceAt(vin, "2026-10-20"), 18);
assert.strictEqual(priceAt(vin, "2026-10-26"), 20);
assert.strictEqual(p.catalog.find((c) => c.id === "jus"), now.catalog[2]); // intact
assert.strictEqual(p.catalog.find((c) => c.id === "new"), now.catalog[3]); // intact
const row = (id) => p.rows.find((r) => r.id === id);
assert.strictEqual(row("cafe").sold, 3); // 2 + 1 extérieur, pas celle du jour d'effet
assert.strictEqual(row("jus").action, "déjà daté correctement");
assert.strictEqual(row("new").action, "nouvel article, inchangé");
assert.strictEqual(row("gone").action, "supprimé depuis (non réparé)");
// Rejouer sur le résultat ne change plus rien.
assert.strictEqual(planRepair(before, Object.assign({}, now, {catalog: p.catalog}), EFF).changes, 0);
console.log("catalog-repair : tous les tests passent");
