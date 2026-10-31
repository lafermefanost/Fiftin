/* Lien de disponibilités d'une structure (demande de César) : pour les
 * habitués, une simple liste de nuits « Disponible / Peut-être /
 * Complet » — jamais de nom de client, jamais de nombre de chambres,
 * jamais de prix. Calcul pur, sans Firestore, testé par
 * availshare.test.js.
 *
 * Une nuit = la nuit du jour J au jour J+1 (arrivée le jour J).
 * Pour chaque location de la structure :
 *   - occupée   : une réservation non annulée et non « option », ou une
 *                 plage importée d'Airbnb / Booking (calendrier iCal) ;
 *   - en option : seulement des réservations « option » (status "opt") ;
 *   - libre     : rien ce soir-là.
 * La nuit est « free » si au moins une location est libre, sinon « maybe »
 * si au moins une n'est qu'en option, sinon « full ».
 */

const DAY_MS = 86400000;

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/* Locations d'une structure : room.group, à défaut la 1re structure du
 * compte (même repli que l'outil, voir defaultStructureId()). */
function structureRooms(settings, structureId) {
  const s = settings || {};
  const structs = Array.isArray(s.structures) && s.structures.length ? s.structures : [{id: "struct1"}];
  const fallback = structs[0].id;
  return (Array.isArray(s.rooms) ? s.rooms : []).filter(function (r) {
    return r && r.id && (r.group || fallback) === structureId;
  });
}

/* days : chaîne d'une lettre par nuit à partir de `from` — F (libre),
 * M (peut-être), X (complet). Compacte et sans aucune autre donnée. */
function structureAvailability(opts) {
  const rooms = opts.rooms || [];
  const bookings = opts.bookings || [];
  const feed = opts.feedRangesByRoom || {};
  const from = opts.from;
  const n = opts.days || 183;
  const roomIds = new Set(rooms.map(function (r) { return r.id; }));
  // Plages bloquantes par location : [checkIn, checkOut), kind "full"/"opt".
  const byRoom = {};
  bookings.forEach(function (b) {
    if (!b || !roomIds.has(b.roomId) || b.status === "no") return;
    if (typeof b.checkIn !== "string" || typeof b.checkOut !== "string" || b.checkOut <= b.checkIn) return;
    (byRoom[b.roomId] = byRoom[b.roomId] || []).push({a: b.checkIn, b: b.checkOut, opt: b.status === "opt"});
  });
  Object.keys(feed).forEach(function (rid) {
    if (!roomIds.has(rid)) return;
    (feed[rid] || []).forEach(function (r) {
      if (!r || typeof r.checkIn !== "string" || typeof r.checkOut !== "string") return;
      (byRoom[rid] = byRoom[rid] || []).push({a: r.checkIn, b: r.checkOut, opt: false});
    });
  });
  let out = "";
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    let anyFree = false, anyOpt = false;
    for (const r of rooms) {
      const ranges = byRoom[r.id] || [];
      let full = false, opt = false;
      for (const x of ranges) {
        if (day >= x.a && day < x.b) { if (x.opt) opt = true; else { full = true; break; } }
      }
      if (!full && !opt) { anyFree = true; break; }
      if (!full && opt) anyOpt = true;
    }
    out += !rooms.length ? "X" : anyFree ? "F" : anyOpt ? "M" : "X";
  }
  return out;
}

/* Numéro WhatsApp : chiffres seuls au format international (wa.me), même
 * règle que waPhoneDigits() de sejours/index.html (cas français 0X → 33X). */
function waDigits(phone) {
  let d = String(phone || "").replace(/[^\d+]/g, "");
  if (d.charAt(0) === "+") d = d.slice(1);
  else if (d.charAt(0) === "0") d = "33" + d.slice(1);
  if (d.slice(0, 3) === "330") d = "33" + d.slice(3);
  return d.length >= 8 ? d : "";
}

/* Identité visuelle de la structure (Réglages → Structures juridiques) :
 * seulement un logo PNG en data URL et deux couleurs #RRGGBB, vérifiés. */
function publicBrand(b) {
  if (!b || typeof b !== "object") return null;
  const hex = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
  const logo = typeof b.logo === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.logo) && b.logo.length < 200000 ? b.logo : null;
  const out = {bg: hex(b.bg), fg: hex(b.fg), logo: logo};
  return out.bg || out.logo ? out : null;
}

module.exports = {structureRooms, structureAvailability, waDigits, addDays, publicBrand};
