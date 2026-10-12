/* Calendriers iCal Airbnb / Booking — fonctions pures (aucun accès
 * Firestore ici), testables isolément : voir functions/ical.test.js.
 *
 * Volontairement sans dépendance npm : les flux d'export d'Airbnb et de
 * Booking sont des calendriers très simples (des VEVENT "journée entière",
 * DTSTART/DTEND en VALUE=DATE, un UID, un SUMMARY générique), sans
 * récurrence ni fuseau à résoudre. Un décodeur minimal et défensif suffit,
 * là où une bibliothèque complète (node-ical : moment-timezone, rrule…)
 * ajouterait beaucoup de code pour des cas que ces flux n'utilisent pas. */

const PLATFORMS = ["airbnb", "booking"];

/* Seuls ces domaines sont acceptés à l'import : la fonction télécharge une
 * adresse saisie par l'utilisateur, il ne faut jamais pouvoir lui faire
 * appeler autre chose (adresses internes de Google Cloud, autres sites). */
function hostAllowed(platform, hostname) {
  const h = String(hostname || "").toLowerCase();
  if (platform === "airbnb") return /(^|\.)airbnb\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
  if (platform === "booking") return /(^|\.)booking\.com$/.test(h);
  return false;
}

function validateImportUrl(platform, url) {
  if (PLATFORMS.indexOf(platform) === -1) return "Plateforme inconnue.";
  let u;
  try { u = new URL(String(url || "").trim()); } catch (e) { return "Ce lien n'est pas une adresse valide."; }
  if (u.protocol !== "https:") return "Le lien doit commencer par https://";
  if (!hostAllowed(platform, u.hostname)) {
    return platform === "airbnb"
      ? "Ce lien ne vient pas d'Airbnb (attendu : un lien airbnb.fr ou airbnb.com se terminant par .ics)."
      : "Ce lien ne vient pas de Booking (attendu : un lien ical.booking.com ou admin.booking.com).";
  }
  return null;
}

// "20261012" ou "20261012T140000Z" -> "2026-10-12"
function toIsoDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(v || "").trim());
  if (!m) return null;
  return m[1] + "-" + m[2] + "-" + m[3];
}

function addDaysIso(ds, n) {
  const d = new Date(ds + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function unescapeText(s) {
  return String(s || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

/* Nature d'un événement, pour décider côté app s'il devient une
 * réservation : Airbnb distingue "Reserved" (vraie réservation) de
 * "Airbnb (Not available)" (dates fermées par l'hôte, ou reflet d'un
 * calendrier importé dans Airbnb — dont celui exporté par Fiftin). Booking
 * n'écrit que "CLOSED - Not available" pour tout : impossible de
 * distinguer une réservation d'une fermeture, d'où "closed". */
function eventKind(platform, summary) {
  const s = String(summary || "").toLowerCase();
  if (platform === "airbnb") {
    if (/not available|unavailable|indisponible|blocked/.test(s)) return "block";
    return "reservation";
  }
  return "closed";
}

/* Décode un flux iCal en liste {uid, start, end, summary, kind}, dates
 * au format AAAA-MM-JJ, end exclusive (= jour du départ, comme checkOut
 * dans l'app). Ignore les événements annulés, mal formés, ou terminés
 * avant `todayIso`. */
function parseIcal(text, platform, todayIso) {
  if (typeof text !== "string" || text.indexOf("BEGIN:VCALENDAR") === -1) {
    throw new Error("Le lien ne renvoie pas un calendrier iCal.");
  }
  // Dépliage RFC 5545 : une ligne qui commence par un espace/tab continue la précédente.
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded = [];
  lines.forEach(function (l) {
    if ((l[0] === " " || l[0] === "\t") && unfolded.length) unfolded[unfolded.length - 1] += l.slice(1);
    else unfolded.push(l);
  });

  const events = [];
  let cur = null;
  unfolded.forEach(function (line) {
    if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; return; }
    if (/^END:VEVENT/i.test(line)) { if (cur) events.push(cur); cur = null; return; }
    if (!cur) return;
    const idx = line.indexOf(":");
    if (idx === -1) return;
    const name = line.slice(0, idx).split(";")[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (name === "UID") cur.uid = value.trim();
    else if (name === "SUMMARY") cur.summary = unescapeText(value);
    else if (name === "DTSTART") cur.start = toIsoDate(value);
    else if (name === "DTEND") cur.end = toIsoDate(value);
    else if (name === "STATUS") cur.status = value.trim().toUpperCase();
  });

  const out = [];
  const seen = {};
  events.forEach(function (e) {
    if (!e.start) return;
    if (e.status === "CANCELLED") return;
    let end = e.end || addDaysIso(e.start, 1);
    if (end <= e.start) end = addDaysIso(e.start, 1);
    if (todayIso && end <= todayIso) return;
    const uid = (e.uid || (platform + "-" + e.start + "-" + end)).slice(0, 200);
    if (seen[uid]) return;
    seen[uid] = true;
    out.push({
      uid: uid,
      start: e.start,
      end: end,
      summary: String(e.summary || "").slice(0, 120),
      kind: eventKind(platform, e.summary),
    });
  });
  out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return out.slice(0, 500);
}

/* Calendrier exporté par Fiftin pour une chambre : uniquement des plages de
 * dates, jamais de nom de client ni aucune autre donnée (il est lu par
 * Airbnb/Booking, et par quiconque possède le lien). Plages qui se
 * chevauchent ou se touchent fusionnées : moins d'événements, et aucune
 * information sur le découpage réel des séjours. */
function mergeRanges(ranges) {
  const sorted = (ranges || [])
    .filter(function (r) { return r && r.start && r.end && r.start < r.end; })
    .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  const out = [];
  sorted.forEach(function (r) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      out.push({start: r.start, end: r.end});
    }
  });
  return out;
}

function buildIcal(ranges, nowDate) {
  const stamp = (nowDate || new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fiftin//Calendrier//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  mergeRanges(ranges).forEach(function (r) {
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + r.start + "_" + r.end + "@fiftin.fr",
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + r.start.replace(/-/g, ""),
      "DTEND;VALUE=DATE:" + r.end.replace(/-/g, ""),
      "SUMMARY:Fiftin - indisponible",
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

module.exports = {PLATFORMS, hostAllowed, validateImportUrl, parseIcal, mergeRanges, buildIcal, addDaysIso};
