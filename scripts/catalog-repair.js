/* Réparation du catalogue des consommations d'UN compte (voir
 * catalog-repair-lib.js). Lancé par le workflow « Réparation du
 * catalogue » à chaque push sur main touchant ce script, sa config ou son
 * mode (scripts/catalog-repair.mode) :
 *   simulation  : lecture seule, rapport dans le journal (noms et prix des
 *                 articles du catalogue seulement, aucune donnée client) ;
 *   application : réécrit UNIQUEMENT le champ `catalog` du compte, dans une
 *                 transaction (recalculée sur l'état du moment, rejouable :
 *                 un 2e passage ne change plus rien).
 * Config (catalog-repair.config.json) : e-mail du compte, instant AVANT
 * les changements (récupération Firestore, 7 jours max), jour d'effet. */
const fs = require("fs");
const path = require("path");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const {planRepair} = require("./catalog-repair-lib");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "catalog-repair.config.json"), "utf8"));
const mode = fs.readFileSync(path.join(__dirname, "catalog-repair.mode"), "utf8").trim();
initializeApp({projectId: process.env.GCLOUD_PROJECT || "fiftin-e30c2"});
const db = getFirestore();

function table(rows) {
  const f = (v) => (v == null ? "—" : String(v) + " €");
  console.log("Article | Prix avant | Prix passé actuel | Prix actuel | Daté ? | Qté vendue avant | Action");
  rows.forEach((r) => console.log([r.name, f(r.before), f(r.pastNow), f(r.price), r.dated ? "oui" : "non", r.sold, r.action].join(" | ")));
}

/* Diagnostic (lecture seule) : quels AUTRES prix ont changé entre les
 * deux instants — tarifs des services (table d'hôtes, petit-déjeuner),
 * tarifs des locations, prix des clients (nombre seulement), réservations
 * modifiées (nombre seulement). Aucun nom de client affiché. */
function diagnose(before, now) {
  // Comparaison insensible à l'ordre des clés (Firestore ne renvoie pas
  // toujours les champs d'une map dans le même ordre).
  const norm = (v) => Array.isArray(v) ? v.map(norm) : (v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o; }, {}) : v);
  const j = (v) => JSON.stringify(norm(v == null ? null : v));
  const sb = before.settings || {}, sn = now.settings || {};
  console.log("\n--- Autres changements entre les deux instants ---");
  const keys = Array.from(new Set(Object.keys(sb).concat(Object.keys(sn)))).filter((k) => j(sb[k]) !== j(sn[k]));
  console.log("Réglages modifiés : " + (keys.length ? keys.join(", ") : "aucun"));
  if (j(sb.tariffHistory) !== j(sn.tariffHistory)) {
    console.log("Tarifs des services (table d'hôtes / petit-déj) — avant : " + j(sb.tariffHistory));
    console.log("Tarifs des services (table d'hôtes / petit-déj) — maintenant : " + j(sn.tariffHistory));
  }
  (sn.rooms || []).forEach((r) => {
    const o = (sb.rooms || []).find((x) => x && x.id === r.id);
    if (!o) { console.log("Location ajoutée : " + r.name); return; }
    if (j(o.tariffHistory) !== j(r.tariffHistory)) {
      console.log("Tarifs de « " + r.name + " » — avant : " + j(o.tariffHistory));
      console.log("Tarifs de « " + r.name + " » — maintenant : " + j(r.tariffHistory));
    }
  });
  const gb = before.guests || [], gn = now.guests || [];
  const gChanged = gn.filter((g) => { const o = gb.find((x) => x && x.id === g.id); return o && (j(o.price) !== j(g.price) || j(o.priceSet) !== j(g.priceSet) || j(o.priceHistory) !== j(g.priceHistory)); }).length;
  console.log("Clients dont le prix a changé : " + gChanged + " (sur " + gn.length + ")");
  const bb = before.bookings || [], bn = now.bookings || [];
  const today = new Date().toISOString().slice(0, 10);
  const bChanged = bn.filter((b) => { const o = bb.find((x) => x && x.id === b.id); return o && j(o) !== j(b); });
  console.log("Réservations modifiées : " + bChanged.length + " (dont " + bChanged.filter((b) => b.checkIn < today).length + " passées), ajoutées : " + bn.filter((b) => !bb.some((x) => x && x.id === b.id)).length + ", supprimées : " + bb.filter((b) => !bn.some((x) => x && x.id === b.id)).length);
  const fields = {};
  bChanged.forEach((b) => { const o = bb.find((x) => x.id === b.id); Object.keys(Object.assign({}, o, b)).forEach((k) => { if (j(o[k]) !== j(b[k])) fields[k] = (fields[k] || 0) + 1; }); });
  if (Object.keys(fields).length) console.log("Champs modifiés dans ces réservations : " + Object.keys(fields).map((k) => k + " ×" + fields[k]).join(", "));
}

(async () => {
  if (mode !== "simulation" && mode !== "application") throw new Error("Mode inconnu : " + mode);
  const uid = (await getAuth().getUserByEmail(cfg.email)).uid;
  const ref = db.collection("accounts").doc(uid);
  const beforeSnap = await db.runTransaction((t) => t.get(ref), {readOnly: true, readTime: Timestamp.fromDate(new Date(cfg.beforeTime))});
  if (!beforeSnap.exists) throw new Error("Compte introuvable à " + cfg.beforeTime);
  const before = beforeSnap.data();
  console.log("Mode : " + mode + " — catalogue relu au " + cfg.beforeTime + " (" + (before.catalog || []).length + " articles), nouveaux prix datés du " + cfg.effective);
  const nowSnap = await ref.get();
  const plan = planRepair(before, nowSnap.data(), cfg.effective);
  console.log("Catalogue actuel : " + (nowSnap.data().catalog || []).length + " articles — " + plan.changes + " à réparer\n");
  table(plan.rows);
  diagnose(before, nowSnap.data());
  if (mode === "simulation") { console.log("\nSimulation : rien n'a été écrit."); return; }
  const written = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const p = planRepair(before, snap.data(), cfg.effective);
    if (!p.changes) return 0;
    t.update(ref, {catalog: p.catalog});
    return p.changes;
  });
  console.log("\nApplication : " + written + " article(s) réparé(s). Relance en simulation pour vérifier (doit afficher 0 à réparer).");
})().catch((e) => { console.error(e); process.exit(1); });
