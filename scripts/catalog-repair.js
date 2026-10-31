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
