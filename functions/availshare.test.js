/* Tests du lien de disponibilités (functions/availshare.js) :
 * node functions/availshare.test.js */
const assert = require("assert");
const {structureRooms, structureAvailability, waDigits, publicBrand} = require("./availshare");

const settings = {
  structures: [{id: "fanost", name: "La Ferme Fanost"}, {id: "vissou", name: "Vissou"}],
  rooms: [
    {id: "a", group: "fanost"}, {id: "b", group: "fanost"},
    {id: "c", group: "vissou"}, {id: "d"}, // sans group → 1re structure
  ],
};
assert.deepStrictEqual(structureRooms(settings, "fanost").map((r) => r.id), ["a", "b", "d"]);
assert.deepStrictEqual(structureRooms(settings, "vissou").map((r) => r.id), ["c"]);
assert.deepStrictEqual(structureRooms(settings, "inconnue"), []);

const rooms = [{id: "a"}, {id: "b"}, {id: "c"}];
const from = "2026-11-01";
const run = (bookings, feed) => structureAvailability({rooms, bookings, feedRangesByRoom: feed, from, days: 6});
const bk = (roomId, checkIn, checkOut, status) => ({roomId, checkIn, checkOut, status});

// Rien de réservé : tout disponible.
assert.strictEqual(run([]), "FFFFFF");
// Une prise sur trois : encore 2 libres → disponible.
assert.strictEqual(run([bk("a", "2026-11-01", "2026-11-04")]), "FFFFFF");
// Deux prises sur trois : une seule libre → peut-être.
assert.strictEqual(run([bk("a", "2026-11-01", "2026-11-04"), bk("b", "2026-11-02", "2026-11-03")]), "FMFFFF");
// Trois prises : complet ; départ le 4 = nuit du 4 de nouveau libre.
assert.strictEqual(run([bk("a", "2026-11-02", "2026-11-04"), bk("b", "2026-11-02", "2026-11-04"), bk("c", "2026-11-01", "2026-11-04")]), "FXXFFF");
// Toutes prises sauf une en option → peut-être.
assert.strictEqual(run([bk("a", "2026-11-01", "2026-11-06"), bk("b", "2026-11-01", "2026-11-06"), bk("c", "2026-11-02", "2026-11-03", "opt")]), "MMMMMF");
// Option sur une location déjà prise par ailleurs : reste complet.
assert.strictEqual(run([bk("a", "2026-11-01", "2026-11-02"), bk("b", "2026-11-01", "2026-11-02"), bk("c", "2026-11-01", "2026-11-02"), bk("c", "2026-11-01", "2026-11-02", "opt")]), "XFFFFF");
// Annulée : ne bloque rien.
assert.strictEqual(run([bk("a", "2026-11-01", "2026-11-03", "no"), bk("b", "2026-11-01", "2026-11-03", "no")]), "FFFFFF");
// Calendrier Airbnb importé : bloque comme une réservation.
assert.strictEqual(run([bk("a", "2026-11-05", "2026-11-07")], {b: [{checkIn: "2026-11-05", checkOut: "2026-11-06"}]}), "FFFFMF");
// Réservation d'une location d'une autre structure : ignorée.
assert.strictEqual(run([bk("z", "2026-11-01", "2026-11-07")]), "FFFFFF");
// Structure d'une seule location : libre = disponible.
const one = (bookings) => structureAvailability({rooms: [{id: "a"}], bookings, from, days: 4});
assert.strictEqual(one([]), "FFFF");
assert.strictEqual(one([bk("a", "2026-11-02", "2026-11-03", "opt"), bk("a", "2026-11-03", "2026-11-04")]), "FMXF");
// Structure sans location : tout complet (rien à proposer).
assert.strictEqual(structureAvailability({rooms: [], bookings: [], from, days: 3}), "XXX");
// Passage de mois.
assert.strictEqual(structureAvailability({rooms: [{id: "a"}], bookings: [bk("a", "2026-11-30", "2026-12-02")], from: "2026-11-29", days: 4}), "FXXF");

assert.strictEqual(waDigits("06 12 34 56 78"), "33612345678");
assert.strictEqual(waDigits("+33 (0)6 12 34 56 78"), "33612345678");
assert.strictEqual(waDigits(""), "");
assert.strictEqual(waDigits("123"), "");

// Identité visuelle : seulement ce qui est sûr à afficher.
assert.strictEqual(publicBrand(null), null);
assert.strictEqual(publicBrand({}), null);
assert.deepStrictEqual(publicBrand({bg: "#123456", fg: "red", palette: ["#000000"]}), {bg: "#123456", fg: null, logo: null});
assert.deepStrictEqual(publicBrand({logo: "data:image/png;base64,iVBORw0KGgo=", bg: "x"}), {bg: null, fg: null, logo: "data:image/png;base64,iVBORw0KGgo="});
assert.strictEqual(publicBrand({logo: "javascript:alert(1)"}), null);
assert.strictEqual(publicBrand({logo: "data:image/svg+xml;base64,PHN2Zz4="}), null);

console.log("availshare : tous les tests passent");
