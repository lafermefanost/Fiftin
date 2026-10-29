/* Comptage des annonces Fiftin Séjours à plusieurs locations — LECTURE SEULE.
 *
 * Un logement = une annonce désormais : avant de retirer l'ancien code
 * « annonce à plusieurs chambres » (ou de découper ces annonces), il faut
 * savoir s'il en reste. Ce script lit listings/ et n'écrit rien.
 *
 * Le rapport (journal du job GitHub) ne contient que des nombres et des
 * identifiants techniques : jamais de nom, de texte, de téléphone,
 * d'e-mail ni d'adresse.
 *
 * Lancé par le workflow « Comptage des annonces à plusieurs locations »
 * (.github/workflows/count-multi-units.yml) à chaque push sur main qui
 * touche ce fichier. */
const admin = require("firebase-admin");

const PROJECT_ID = process.env.COUNT_PROJECT || "fiftin-e30c2"; // COUNT_PROJECT : tests sur émulateur uniquement
admin.initializeApp({projectId: PROJECT_ID});
const db = admin.firestore();

(async () => {
  const snap = await db.collection("listings").get();
  const byStatus = {};
  const multi = [];
  let noUnit = 0;
  snap.forEach((doc) => {
    const l = doc.data();
    const status = l.status || "(aucun)";
    byStatus[status] = (byStatus[status] || 0) + 1;
    const units = Array.isArray(l.units) ? l.units : [];
    if (!units.length) noUnit++;
    if (units.length > 1) {
      multi.push({
        id: doc.id,
        status: status,
        locations: units.length,
        photosAnnonce: (l.gallery || []).length,
        locationsAvecPhotos: units.filter((u) => (u.gallery || []).length).length,
        locationsReliéesPlanning: units.filter((u) => u.linkedRoomId).length,
        associée: l.siteId ? "oui" : "non",
      });
    }
  });

  console.log("Annonces : " + snap.size);
  Object.keys(byStatus).sort().forEach((s) => console.log("  statut " + s + " : " + byStatus[s]));
  console.log("Annonces sans aucune location : " + noUnit);
  console.log("Annonces à plusieurs locations : " + multi.length);
  multi.forEach((m) => {
    console.log("  - " + m.id + " | " + m.status + " | " + m.locations + " locations | " +
      m.photosAnnonce + " photos d'annonce | " + m.locationsAvecPhotos + " locations avec photos | " +
      m.locationsReliéesPlanning + " reliées à Planning | associée : " + m.associée);
  });
  console.log("Rien n'a été écrit.");
})().catch((err) => {
  console.error("Échec du comptage : " + (err && err.message));
  process.exit(1);
});
