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
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const Stripe = require("stripe");

initializeApp();
const db = getFirestore();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
function stripeClient() {
  return new Stripe(STRIPE_SECRET_KEY.value());
}

/* Formules payantes et leurs Price Stripe (mêmes valeurs internes que
 * HOST_FORMULAS côté sejours/index.html et S.settings.plan côté app/) —
 * "simple" (Formule Hôte, gratuite) n'a volontairement aucun Price Stripe,
 * voir le commentaire au-dessus de createCheckoutSession(). */
const STRIPE_PRICE_IDS = {
  essentiel: "price_1UMrAwJYGb3t10ZmLtEumqME",
  pro: "price_1UMrDUJYGb3t10Zm4bbJlIzE",
};
const PLAN_BY_PRICE_ID = {
  [STRIPE_PRICE_IDS.essentiel]: "essentiel",
  [STRIPE_PRICE_IDS.pro]: "pro",
};

/* Comptes exemptés de tout paiement, toujours en formule Avancé (pro) —
 * compte propriétaire + comptes de test/démo. Même principe que
 * ADMIN_EMAILS côté sejours/index.html (liste en clair, à tenir à jour ici
 * si un compte exempté change d'adresse email) : voir enforceFreeProAccounts()
 * plus bas, qui applique cette liste, et le garde-fou dans
 * createCheckoutSession() qui refuse de les faire payer par erreur. */
const FREE_PRO_EMAILS = [
  "lafermefanost@gmail.com",
  "cesarmarandin@gmail.com",
  // TODO césar : adresse email du compte de test "Adel" à ajouter ici.
];

/* Index public léger des annonces publiées (listingIndex/{listingId}),
 * pensé pour que le fil voyageur (sejours/index.html) reste rapide même
 * avec beaucoup d'annonces : la carte (tous les pins, en permanence,
 * même sans filtre) et le calcul filtres/tri/distance ont besoin de
 * connaître TOUTES les annonces publiées, mais seulement de leurs champs
 * légers (position, prix, lieu, prestations) — jamais la GALERIE complète
 * ni le détail des chambres, le vrai poids d'une annonce. Sans cet index,
 * le client devrait télécharger chaque document COMPLET (galeries
 * comprises) juste pour savoir où placer un point sur la carte.
 * thumbUrl fait exception, volontairement : une seule URL (texte, pas des
 * octets d'image) vers la plus petite miniature déjà générée
 * (galleryThumb, voir makeThumbFile() côté client), nécessaire à la
 * popup miniature de la carte (retour utilisateur : "une miniature soit
 * affichée au niveau du point") — sans elle, cette popup n'a tout
 * simplement aucune image à montrer, listingIndex étant sa seule source
 * pour la quasi-totalité des annonces affichées sur Explorer.
 *
 * Républié à chaque écriture sur listings/{listingId} (création,
 * modification, suppression, validation/refus par un admin) — supprimé
 * de l'index dès que status n'est plus "published" (annonce en attente,
 * refusée, ou effacée), jamais montré tant qu'un admin ne l'a pas validée.
 *
 * maxPersons/ownerUid (LOT 2.3, sejours/index.html) : ajoutés pour le
 * filtre Voyageurs — capacité par annonce (matchesAllFilters()) et
 * regroupement "même hôte, même adresse" quand aucune annonce seule
 * n'atteint la capacité demandée (groupedCapacityMatches()), qui a aussi
 * besoin de lat/lng, déjà présents ci-dessous. */
function listingIndexPrice(listing) {
  if (listing.units && listing.units.length) {
    return Math.min.apply(null, listing.units.map(function (u) { return u.price; }));
  }
  return listing.price;
}
// LOT 2.3 (filtre Voyageurs, sejours/index.html) : capacité MAX parmi les
// locations de l'annonce — une annonce passe le filtre si AU MOINS une de
// ses locations suffit seule, même principe que listingIndexPrice()
// ci-dessus (min pour le prix affiché, max pour la capacité utile).
function listingIndexMaxPersons(listing) {
  if (listing.units && listing.units.length) {
    return Math.max.apply(null, listing.units.map(function (u) { return u.maxPersons || 0; }));
  }
  return listing.maxPersons || 0;
}
// Même repli que listingThumbUrl() côté client (sejours/index.html) :
// galerie de l'établissement, sinon la 1ère chambre qui en a une.
function listingIndexThumb(listing) {
  if (listing.galleryThumb && listing.galleryThumb.length && listing.galleryThumb[0]) return listing.galleryThumb[0];
  if (listing.gallery && listing.gallery.length) return listing.gallery[0];
  var units = listing.units || [];
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.galleryThumb && u.galleryThumb.length && u.galleryThumb[0]) return u.galleryThumb[0];
    if (u.gallery && u.gallery.length) return u.gallery[0];
  }
  return null;
}

exports.syncPublicListingIndex = onDocumentWritten("listings/{listingId}", async (event) => {
  const listingId = event.params.listingId;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const indexRef = db.collection("listingIndex").doc(listingId);

  if (!after || after.status !== "published") {
    await indexRef.delete().catch(function () {});
    return;
  }

  await indexRef.set({
    name: after.name || "",
    price: listingIndexPrice(after),
    maxPersons: listingIndexMaxPersons(after),
    ownerUid: after.ownerUid || "",
    accomType: after.accomType || "",
    lat: (typeof after.lat === "number") ? after.lat : null,
    lng: (typeof after.lng === "number") ? after.lng : null,
    region: after.region || "",
    regionName: after.regionName || "",
    deptName: after.deptName || "",
    city: after.city || "",
    amen: after.amen || [],
    likeCount: (typeof after.likeCount === "number") ? after.likeCount : 0,
    createdAt: after.createdAt || null,
    // Juste les identifiants (pas les objets chambre complets — photos,
    // prix — qui resteraient hors de cet index volontairement léger, voir
    // le commentaire plus haut) : le filtre Date du fil voyageur
    // (sejours/index.html, fetchListingAvailability()) en a besoin pour
    // savoir quels listings/{listingId}/publicAvail/{unitId} interroger
    // sans avoir à charger l'annonce complète.
    unitIds: (after.units || []).map(function (u) { return u.id; }),
    thumbUrl: listingIndexThumb(after),
  });
});

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

/* ---------------- Facturation Stripe (formules Essentiel/Avancé) ----------------
 *
 * accounts/{uid}.settings.plan reste la seule source de vérité lue par
 * sejours/index.html (resolveHostAccount()) et app/ (S.settings.plan) —
 * rien ne change côté lecture. Ce qui change : ce champ, et le nouveau
 * accounts/{uid}.billing, ne sont plus écrits par le client (voir
 * setPlan() côté app/, à retirer/remplacer par un appel à
 * createCheckoutSession ci-dessous) mais UNIQUEMENT par stripeWebhook(),
 * avec le SDK Admin — même principe que publicAvail ou listingIndex plus
 * haut dans ce fichier : seul le serveur, qui a vérifié la signature
 * Stripe, peut décider qu'un compte passe en formule payante.
 *
 * "simple" (Formule Hôte, gratuite) n'a pas de Price Stripe : on ne fait
 * jamais payer 0 €, ce plan reste juste la valeur par défaut d'un compte
 * sans abonnement Stripe actif. Quand elle deviendra payante (7 €/mois
 * après la 1ère année gratuite, voir accounts/{uid}.createdAt), il
 * faudra créer son Price Stripe et l'ajouter à STRIPE_PRICE_IDS. */

/* Appelée depuis le site (bouton "Passer à la formule X") : ouvre une
 * session Stripe Checkout en mode abonnement et renvoie son URL, vers
 * laquelle le client redirige lui-même (window.location = url). Crée le
 * Customer Stripe au premier appel, le réutilise ensuite. */
exports.createCheckoutSession = onCall({secrets: [STRIPE_SECRET_KEY]}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const uid = request.auth.uid;
  const email = request.auth.token.email || null;

  if (email && FREE_PRO_EMAILS.indexOf(email.toLowerCase()) !== -1) {
    // Comptes exemptés (voir FREE_PRO_EMAILS) : jamais de paiement réel,
    // leur formule "pro" est garantie par enforceFreeProAccounts() plus bas.
    throw new HttpsError("failed-precondition", "Ce compte est exempté de paiement — formule Avancé déjà active.");
  }

  const plan = request.data && request.data.plan;
  const priceId = STRIPE_PRICE_IDS[plan];
  if (!priceId) throw new HttpsError("invalid-argument", "Formule inconnue : " + plan);

  const stripe = stripeClient();
  const accountRef = db.collection("accounts").doc(uid);
  const accountSnap = await accountRef.get();
  const existing = accountSnap.exists ? accountSnap.data() : null;

  let customerId = existing && existing.billing && existing.billing.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: email || undefined,
      metadata: {firebaseUid: uid},
    });
    customerId = customer.id;
    await accountRef.set({billing: {stripeCustomerId: customerId}}, {merge: true});
  }

  const successUrl = (request.data && request.data.successUrl) || "https://fiftin.fr/app/";
  const cancelUrl = (request.data && request.data.cancelUrl) || "https://fiftin.fr/app/";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: uid,
    line_items: [{price: priceId, quantity: 1}],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {metadata: {firebaseUid: uid}},
  });

  return {url: session.url};
});

/* Appelée depuis "Réglages → Compte" (bouton "Gérer mon abonnement") :
 * ouvre le Portail Client Stripe — changement de carte, résiliation,
 * factures, tout géré par Stripe lui-même, rien à construire côté
 * Fiftin (cohérent avec les CGV : "pas un logiciel de facturation"). */
exports.createPortalSession = onCall({secrets: [STRIPE_SECRET_KEY]}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const uid = request.auth.uid;

  const accountSnap = await db.collection("accounts").doc(uid).get();
  const billing = accountSnap.exists ? accountSnap.data().billing : null;
  const customerId = billing && billing.stripeCustomerId;
  if (!customerId) throw new HttpsError("failed-precondition", "Aucun abonnement Stripe pour ce compte.");

  const stripe = stripeClient();
  const returnUrl = (request.data && request.data.returnUrl) || "https://fiftin.fr/app/";
  const portal = await stripe.billingPortal.sessions.create({customer: customerId, return_url: returnUrl});
  return {url: portal.url};
});

/* Met accounts/{uid}.billing et .settings.plan à jour à partir d'un
 * abonnement Stripe réel (jamais l'inverse) — appelée par stripeWebhook()
 * pour chaque événement concerné. active/trialing => la formule du Price
 * souscrit ; canceled/unpaid => retour à "simple" (Formule Hôte) ; les
 * autres statuts (past_due, incomplete...) ne changent pas la formule
 * elle-même, seul accounts/{uid}.billing.status reflète l'alerte. */
async function applySubscriptionToAccount(uid, subscription) {
  const priceId = subscription.items.data[0] && subscription.items.data[0].price.id;
  const plan = PLAN_BY_PRICE_ID[priceId] || null;
  const status = subscription.status;

  const update = {
    billing: {
      stripeCustomerId: subscription.customer,
      stripeSubscriptionId: subscription.id,
      status: status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    },
  };
  if (plan && (status === "active" || status === "trialing")) {
    update.settings = {plan: plan};
  } else if (status === "canceled" || status === "unpaid") {
    update.settings = {plan: "simple"};
  }
  await db.collection("accounts").doc(uid).set(update, {merge: true});
}

/* Point d'entrée des événements Stripe (à configurer dans Stripe Dashboard
 * → Développeurs → Webhooks, avec l'URL de cette fonction une fois
 * déployée). Body brut obligatoire (pas de JSON.parse avant) : c'est sur
 * les octets exacts reçus que la signature Stripe est vérifiée — toute
 * transformation préalable la casserait. */
exports.stripeWebhook = onRequest({secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]}, async (req, res) => {
  const stripe = stripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET.value());
  } catch (err) {
    console.error("[stripeWebhook] signature invalide :", err.message);
    res.status(400).send("Signature invalide");
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.client_reference_id;
      if (uid && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await applySubscriptionToAccount(uid, subscription);
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const uid = subscription.metadata && subscription.metadata.firebaseUid;
      if (uid) await applySubscriptionToAccount(uid, subscription);
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const uid = subscription.metadata && subscription.metadata.firebaseUid;
        if (uid) await applySubscriptionToAccount(uid, subscription);
      }
    }
    res.json({received: true});
  } catch (err) {
    console.error("[stripeWebhook] erreur de traitement :", err);
    res.status(500).send("Erreur serveur");
  }
});

/* Comptes exemptés (FREE_PRO_EMAILS ci-dessus) : à chaque écriture sur
 * leur accounts/{uid} — y compris la toute première après déploiement —
 * on vérifie que la formule reste "pro", quoi qu'il arrive ailleurs
 * (resynchro app/, future modification manuelle...). Se relit elle-même
 * après avoir écrit (onDocumentWritten se redéclenche sur son propre
 * write) mais s'arrête aussitôt grâce au test "déjà correct" ci-dessous —
 * sans lui, boucle infinie. Ne coûte rien pour tous les autres comptes
 * (sort dès que l'email ne correspond pas). */
exports.enforceFreeProAccounts = onDocumentWritten("accounts/{uid}", async (event) => {
  const uid = event.params.uid;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;

  let email;
  try {
    email = (await getAuth().getUser(uid)).email;
  } catch (err) {
    return; // utilisateur introuvable (supprimé entre-temps) : rien à faire
  }
  if (!email || FREE_PRO_EMAILS.indexOf(email.toLowerCase()) === -1) return;

  const alreadyOk = after.settings && after.settings.plan === "pro" && after.billing && after.billing.exempt === true;
  if (alreadyOk) return;

  await db.collection("accounts").doc(uid).set({
    settings: {plan: "pro"},
    billing: {exempt: true},
  }, {merge: true});
});
