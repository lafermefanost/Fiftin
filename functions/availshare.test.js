/* Tests du lien de disponibilités (functions/availshare.js) :
 * node functions/availshare.test.js */
const assert = require("assert");
const {structureRooms, structureAvailability, waDigits} = require("./availshare");

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

const rooms = [{id: "a"}, {id: "b"}];
const from = "2026-11-01";
const run = (bookings, feed) => structureAvailability({rooms, bookings, feedRangesByRoom: feed, from, days: 6});

// Rien de réservé : tout libre.
assert.strictEqual(run([]), "FFFFFF");
// Une seule chambre prise : encore libre (au moins une libre).
assert.strictEqual(run([{roomId: "a", checkIn: "2026-11-01", checkOut: "2026-11-04"}]), "FFFFFF");
// Les deux prises les nuits du 2 et du 3 ; départ le 4 = nuit du 4 libre.
assert.strictEqual(run([
  {roomId: "a", checkIn: "2026-11-02", checkOut: "2026-11-04"},
  {roomId: "b", checkIn: "2026-11-01", checkOut: "2026-11-04"},
]), "FXXFFF");
// Une option sur la dernière chambre libre → « peut-être ».
assert.strictEqual(run([
  {roomId: "a", checkIn: "2026-11-01", checkOut: "2026-11-06"},
  {roomId: "b", checkIn: "2026-11-02", checkOut: "2026-11-03", status: "opt"},
]), "FMFFFF");
// Option sur une chambre déjà prise ailleurs : reste complet.
assert.strictEqual(run([
  {roomId: "a", checkIn: "2026-11-01", checkOut: "2026-11-02"},
  {roomId: "b", checkIn: "2026-11-01", checkOut: "2026-11-02"},
  {roomId: "b", checkIn: "2026-11-01", checkOut: "2026-11-02", status: "opt"},
]), "XFFFFF");
// Annulée : ne bloque rien.
assert.strictEqual(run([
  {roomId: "a", checkIn: "2026-11-01", checkOut: "2026-11-03", status: "no"},
  {roomId: "b", checkIn: "2026-11-01", checkOut: "2026-11-03"},
]), "FFFFFF");
// Calendrier Airbnb importé : bloque comme une réservation.
assert.strictEqual(run(
  [{roomId: "a", checkIn: "2026-11-05", checkOut: "2026-11-07"}],
  {b: [{checkIn: "2026-11-05", checkOut: "2026-11-06"}]}
), "FFFFXF");
// Réservation d'une location d'une autre structure : ignorée.
assert.strictEqual(run([{roomId: "c", checkIn: "2026-11-01", checkOut: "2026-11-07"}]), "FFFFFF");
// Structure sans location : tout complet (rien à proposer).
assert.strictEqual(structureAvailability({rooms: [], bookings: [], from, days: 3}), "XXX");
// Passage de mois.
assert.strictEqual(structureAvailability({rooms: [{id: "a"}], bookings: [{roomId: "a", checkIn: "2026-11-30", checkOut: "2026-12-02"}], from: "2026-11-29", days: 4}), "FXXF");

assert.strictEqual(waDigits("06 12 34 56 78"), "33612345678");
assert.strictEqual(waDigits("+33 (0)6 12 34 56 78"), "33612345678");
assert.strictEqual(waDigits(""), "");
assert.strictEqual(waDigits("123"), "");

console.log("availshare : tous les tests passent");
