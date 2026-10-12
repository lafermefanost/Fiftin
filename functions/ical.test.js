/* Tests des fonctions pures iCal (functions/ical.js) — sans dépendance :
 *   node functions/ical.test.js
 * Les flux d'exemple reproduisent le format réel des exports Airbnb et
 * Booking (VEVENT journée entière, SUMMARY génériques). */
const assert = require("assert");
const ical = require("./ical");

const AIRBNB = [
  "BEGIN:VCALENDAR", "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN", "CALSCALE:GREGORIAN", "VERSION:2.0",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20261018", "DTSTART;VALUE=DATE:20261015", "UID:1418fb94e984-aaa@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC123\\nPhone Number (L", " ast 4 Digits): 1234", "SUMMARY:Reserved", "END:VEVENT",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20261103", "DTSTART;VALUE=DATE:20261101", "UID:1418fb94e984-bbb@airbnb.com", "SUMMARY:Airbnb (Not available)", "END:VEVENT",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20250105", "DTSTART;VALUE=DATE:20250102", "UID:old@airbnb.com", "SUMMARY:Reserved", "END:VEVENT",
  "END:VCALENDAR", ""].join("\r\n");

const BOOKING = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//admin.booking.com//EN",
  "BEGIN:VEVENT", "UID:abc123@booking.com", "DTSTART;VALUE=DATE:20261020", "DTEND;VALUE=DATE:20261022", "SUMMARY:CLOSED - Not available", "END:VEVENT",
  "BEGIN:VEVENT", "UID:cancel@booking.com", "DTSTART;VALUE=DATE:20261025", "DTEND;VALUE=DATE:20261026", "STATUS:CANCELLED", "SUMMARY:x", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261201T150000Z", "SUMMARY:no uid no end", "END:VEVENT",
  "END:VCALENDAR"].join("\n");

// Airbnb : passés ignorés, Reserved = reservation, Not available = block
let ev = ical.parseIcal(AIRBNB, "airbnb", "2026-10-12");
assert.deepStrictEqual(ev.map((e) => [e.uid, e.start, e.end, e.kind]), [
  ["1418fb94e984-aaa@airbnb.com", "2026-10-15", "2026-10-18", "reservation"],
  ["1418fb94e984-bbb@airbnb.com", "2026-11-01", "2026-11-03", "block"],
]);

// Booking : annulé ignoré, sans DTEND = 1 nuit, sans UID = UID synthétique stable
ev = ical.parseIcal(BOOKING, "booking", "2026-10-12");
assert.deepStrictEqual(ev.map((e) => [e.uid, e.start, e.end, e.kind]), [
  ["abc123@booking.com", "2026-10-20", "2026-10-22", "closed"],
  ["booking-2026-12-01-2026-12-02", "2026-12-01", "2026-12-02", "closed"],
]);

assert.throws(() => ical.parseIcal("<html>login</html>", "airbnb", "2026-10-12"));

// Domaines acceptés / refusés
assert.strictEqual(ical.validateImportUrl("airbnb", "https://www.airbnb.fr/calendar/ical/123.ics?s=abc"), null);
assert.strictEqual(ical.validateImportUrl("airbnb", "https://www.airbnb.co.uk/calendar/ical/1.ics"), null);
assert.strictEqual(ical.validateImportUrl("booking", "https://ical.booking.com/v1/export?t=abc"), null);
assert.strictEqual(ical.validateImportUrl("booking", "https://admin.booking.com/hotel/x.ics"), null);
assert.ok(ical.validateImportUrl("airbnb", "http://www.airbnb.fr/x.ics"));
assert.ok(ical.validateImportUrl("airbnb", "https://airbnb.fr.evil.com/x.ics"));
assert.ok(ical.validateImportUrl("airbnb", "https://169.254.169.254/x"));
assert.ok(ical.validateImportUrl("booking", "https://notbooking.com/x"));
assert.ok(ical.validateImportUrl("other", "https://www.airbnb.fr/x"));

// Export : fusion des plages, pas de nom
const out = ical.buildIcal([
  {start: "2026-10-15", end: "2026-10-18"}, {start: "2026-10-18", end: "2026-10-20"},
  {start: "2026-10-16", end: "2026-10-17"}, {start: "2026-11-01", end: "2026-11-02"},
], new Date("2026-10-12T10:00:00Z"));
assert.strictEqual((out.match(/BEGIN:VEVENT/g) || []).length, 2);
assert.ok(out.includes("DTSTART;VALUE=DATE:20261015\r\nDTEND;VALUE=DATE:20261020"));
// Aller-retour : ce que Fiftin exporte se relit comme un calendrier valide
const back = ical.parseIcal(out, "booking", "2026-10-12");
assert.deepStrictEqual(back.map((e) => [e.start, e.end]), [["2026-10-15", "2026-10-20"], ["2026-11-01", "2026-11-02"]]);

console.log("ical.test.js : OK");
