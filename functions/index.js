/* Cloud Functions Fiftin — projection publique des disponibilités.
 *
 * Rôle unique : republier, dans listings/{listingId}/publicAvail/{unitId},
 * UNIQUEMENT des dates d'arrivée/départ (checkIn/checkOut) — jamais de nom
 * de client, jamais de prix, jamais aucune autre donnée — pour que le
 * calendrier voyageur de Fiftin Séjours (sejours/index.html) puisse
 * afficher une disponibilité réelle sans jamais avoir accès aux données
 * privées d'où elle vient (accounts/{uid} et listings/{id}/bookings, toutes
 * deux réservées au propriétaire par les règles Firestore).
 *
 * Écrit avec le SDK Admin, qui contourne les règles Firestore — c'est
 * volontaire et c'est précisément ce qui permet à la règle
 * `publicAvail` d'interdire toute écriture cliente (`allow write: if
 * false`, voir README) : seule cette fonction, exécutée côté serveur, peut
 * publier ces documents. Aucun client (même le propriétaire connecté) ne
 * peut donc y écrire n'importe quoi.
 *
 * Deux déclencheurs, un par source de réservations existante dans ce
 * projet (voir README « Comptes et données ») :
 *   - accounts/{uid}            : compte gestion (vraies données app/),
 *     bookings est un TABLEAU sur le document du compte, pas une
 *     sous-collection.
 *   - listings/{id}/bookings/*  : compte simple annonce, une vraie
 *     sous-collection Firestore, un document par réservation.
 */

const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

function toPublicRanges(bookings) {
  return (bookings || [])
    .filter(function (b) { return b && typeof b.checkIn === "string" && typeof b.checkOut === "string"; })
    .map(function (b) { return {checkIn: b.checkIn, checkOut: b.checkOut}; });
}

function writePublicAvail(listingId, unitId, ranges) {
  return db.collection("listings").doc(listingId).collection("publicAvail").doc(unitId)
    .set({ranges: ranges, updatedAt: new Date().toISOString()});
}

/* Compte gestion : à chaque écriture sur accounts/{uid} (nouvelle
 * réservation, modification, suppression — onDocumentWritten couvre les
 * trois), on retrouve les annonces Séjours de ce propriétaire qui ont au
 * moins une chambre liée (unit.linkedRoomId) et on republie, pour
 * CHACUNE, uniquement les dates de LA chambre app/ à laquelle elle est
 * liée — jamais les réservations des autres chambres du compte. */
exports.syncPublicAvailFromAccount = onDocumentWritten("accounts/{uid}", async (event) => {
  const uid = event.params.uid;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const bookings = (after && after.bookings) || [];

  const listingsSnap = await db.collection("listings").where("ownerUid", "==", uid).get();
  const writes = [];
  listingsSnap.forEach(function (doc) {
    const listing = doc.data();
    (listing.units || []).forEach(function (unit) {
      if (!unit.linkedRoomId) return;
      const roomBookings = bookings.filter(function (b) { return b.roomId === unit.linkedRoomId; });
      writes.push(writePublicAvail(doc.id, unit.id, toPublicRanges(roomBookings)));
    });
  });
  await Promise.all(writes);
});

/* Compte simple annonce : à chaque écriture dans
 * listings/{listingId}/bookings, on republie les dates de CETTE chambre
 * pour CETTE annonce — pas de notion de linkedRoomId ici, une réservation
 * appartient déjà directement à une chambre (unitId) de l'annonce. On
 * relit toute la sous-collection filtrée par unitId plutôt que de ne
 * traiter que le document modifié, pour rester correct même après une
 * suppression (le document qui vient de disparaître ne doit plus compter). */
exports.syncPublicAvailFromListingBookings = onDocumentWritten(
  "listings/{listingId}/bookings/{bookingId}",
  async (event) => {
    const listingId = event.params.listingId;
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    const unitId = (after && after.unitId) || (before && before.unitId);
    if (!unitId) return;

    const bookingsSnap = await db.collection("listings").doc(listingId).collection("bookings")
      .where("unitId", "==", unitId).get();
    const bookings = bookingsSnap.docs.map(function (d) { return d.data(); });
    await writePublicAvail(listingId, unitId, toPublicRanges(bookings));
  }
);

/* Taux de conversion demandes -> séjours d'une annonce (Fiftin Séjours,
 * Envies -> Demandes, voir sejours/index.html), affiché uniquement à
 * l'hôte propriétaire dans sa propre fiche détail (conversionLabelFor()).
 *
 * contactLog/{uid}/entries est strictement privé à son auteur (voir
 * règles Firestore) : aucun client, pas même un compte admin, ne peut
 * lire les demandes des AUTRES voyageurs pour calculer ce taux
 * lui-même. Seule cette fonction, avec le SDK Admin qui contourne les
 * règles, peut agréger across tous les voyageurs — même principe que
 * syncPublicAvailFromAccount ci-dessus pour la disponibilité.
 *
 * Volontairement incrémental (FieldValue.increment sur listings/{id}.
 * stats.demandeCount / .confirmedCount) plutôt que de tout recompter à
 * chaque écriture : pas besoin de relire toutes les demandes de tous les
 * voyageurs pour une annonce (ça exigerait une requête collectionGroup
 * sur "entries", donc un index composite en plus à créer), l'événement
 * reçu (création/mise à jour de statut/suppression) suffit à lui seul à
 * savoir de combien bouger chaque compteur. */
exports.syncListingContactStats = onDocumentWritten(
  "contactLog/{uid}/entries/{entryId}",
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;

    const wasConfirmed = !!(before && before.status === "confirmed");
    const isConfirmed = !!(after && after.status === "confirmed");

    let listingId = null;
    let demandeDelta = 0;
    let confirmedDelta = 0;

    if (!before && after) {
      // nouvelle demande
      listingId = after.listingId;
      demandeDelta = 1;
      confirmedDelta = isConfirmed ? 1 : 0;
    } else if (before && !after) {
      // demande supprimée (déclinée par le voyageur, voir declineContactLogEntry())
      listingId = before.listingId;
      demandeDelta = -1;
      confirmedDelta = wasConfirmed ? -1 : 0;
    } else if (before && after && !wasConfirmed && isConfirmed) {
      // confirmée par le voyageur (confirmContactLogEntry()) — listingId ne change jamais sur une mise à jour
      listingId = after.listingId;
      confirmedDelta = 1;
    }

    if (!listingId || (!demandeDelta && !confirmedDelta)) return;

    const fields = {};
    if (demandeDelta) fields["stats.demandeCount"] = FieldValue.increment(demandeDelta);
    if (confirmedDelta) fields["stats.confirmedCount"] = FieldValue.increment(confirmedDelta);

    await db.collection("listings").doc(listingId).update(fields).catch(function () {
      // l'annonce a pu être supprimée entre-temps : rien de plus à corriger.
    });
  }
);
