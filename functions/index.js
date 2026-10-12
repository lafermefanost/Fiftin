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
const {onSchedule} = require("firebase-functions/v2/scheduler");
const crypto = require("crypto");
const ical = require("./ical");
const {defineSecret} = require("firebase-functions/params");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const Stripe = require("stripe");

initializeApp();
const db = getFirestore();

/* Région des déclencheurs Firestore (onDocumentWritten) : europe-west1,
 * celle où ils tournent déjà en production — un déclencheur Firestore
 * doit être proche de l'emplacement de la base. Sans cette option, le
 * code les déclarait en us-central1 (région par défaut) : un déploiement
 * aurait voulu les recréer là-bas et supprimer ceux d'europe-west1
 * (premier déploiement automatique, refusé pour cette raison). Les
 * fonctions appelées par l'app (onCall/onRequest : Stripe, iCal) restent
 * dans la région par défaut, us-central1, celle qu'utilise
 * firebase.functions() côté client. */
const FIRESTORE_TRIGGER_REGION = "europe-west1";

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
  "adelmarandin@gmail.com",
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

exports.syncPublicListingIndex = onDocumentWritten({document: "listings/{listingId}", region: FIRESTORE_TRIGGER_REGION}, async (event) => {
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
exports.syncPublicAvailFromAccount = onDocumentWritten({document: "accounts/{uid}", region: FIRESTORE_TRIGGER_REGION}, async (event) => {
  const uid = event.params.uid;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  await republishAccountAvail(uid, (after && after.bookings) || []);
});

/* Republie la disponibilité publique de toutes les chambres liées d'un
 * compte gestion. Partagée entre syncPublicAvailFromAccount (à chaque
 * écriture du compte) et icalScheduledSync (quand un calendrier Airbnb/
 * Booking importé change, même si l'hôte n'a pas ouvert l'app : ses
 * réservations plateformes bloquent alors quand même les dates côté
 * voyageur). Les réservations annulées (status "no") ne bloquent plus
 * aucune date — elles le faisaient jusqu'ici, toPublicRanges ne
 * regardant pas le statut. */
async function republishAccountAvail(uid, bookings) {
  const listingsSnap = await db.collection("listings").where("ownerUid", "==", uid).get();
  if (listingsSnap.empty) return;
  const feedRangesByRoom = await icalRangesByRoom(uid);
  const writes = [];
  listingsSnap.forEach(function (doc) {
    const listing = doc.data();
    (listing.units || []).forEach(function (unit) {
      if (!unit.linkedRoomId) return;
      const roomBookings = (bookings || []).filter(function (b) { return b && b.roomId === unit.linkedRoomId && b.status !== "no"; });
      const ranges = toPublicRanges(roomBookings).concat(feedRangesByRoom[unit.linkedRoomId] || []);
      writes.push(writePublicAvail(doc.id, unit.id, ranges));
    });
  });
  await Promise.all(writes);
}

/* Compte simple annonce : à chaque écriture dans
 * listings/{listingId}/bookings, on republie les dates de CETTE chambre
 * pour CETTE annonce — pas de notion de linkedRoomId ici, une réservation
 * appartient déjà directement à une chambre (unitId) de l'annonce. On
 * relit toute la sous-collection filtrée par unitId plutôt que de ne
 * traiter que le document modifié, pour rester correct même après une
 * suppression (le document qui vient de disparaître ne doit plus compter). */
exports.syncPublicAvailFromListingBookings = onDocumentWritten(
  {document: "listings/{listingId}/bookings/{bookingId}", region: FIRESTORE_TRIGGER_REGION},
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
  {document: "contactLog/{uid}/entries/{entryId}", region: FIRESTORE_TRIGGER_REGION},
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

/* Durée de l'essai gratuit (retour utilisateur, confirmé dans le README —
 * "Paiement en ligne (Stripe) — essai gratuit 15 jours, puis abonnement
 * réel") — uniquement pour un premier passage en formule payante : cette
 * fonction n'est appelée que pour un compte encore en formule "simple"
 * (voir son wiring côté client, renderHostProfile()/mktPlanCardHtml() —
 * un compte déjà abonné passe par createPortalSession à la place, jamais
 * par ici), donc jamais un second essai pour un changement essentiel<->pro. */
const TRIAL_PERIOD_DAYS = 15;

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
    // Pas de carte exigée pour démarrer l'essai (retour utilisateur) —
    // si le client en ajoute une quand même (ou que l'essai se termine),
    // Stripe l'utilise normalement pour le 1er prélèvement réel.
    payment_method_collection: "if_required",
    subscription_data: {
      metadata: {firebaseUid: uid},
      trial_period_days: TRIAL_PERIOD_DAYS,
      // À la fin des 15 jours, sans carte enregistrée : annulation plutôt
      // que mise en pause (retour utilisateur, "perd ses infos de planning ?"
      // — non, voir applySubscriptionToAccount(), seul settings.plan change,
      // jamais les données) — repasse proprement en Formule Hôte gratuite,
      // reprend tout tel quel dès qu'il se réabonne.
      trial_settings: {end_behavior: {missing_payment_method: "cancel"}},
    },
  });

  return {url: session.url};
});

/* Garantit par le code (plutôt que par un réglage à retrouver dans le
 * tableau de bord Stripe — celui-ci ne proposait pas l'option "changer de
 * formule" dans la configuration par défaut du Portail Client) que le
 * Portail Client autorise : la résiliation ET le passage d'Essentiel à
 * Avancé ou inversement, pour un abonnement déjà actif. Créée une seule
 * fois (son id est mémorisé dans config/stripePortal), réutilisée à
 * chaque appel ensuite — jamais recréée pour rien. */
async function ensurePortalConfiguration(stripe) {
  const existing = await db.collection("config").doc("stripePortal").get();
  if (existing.exists && existing.data().configurationId) return existing.data().configurationId;

  const essentielPrice = await stripe.prices.retrieve(STRIPE_PRICE_IDS.essentiel);
  const proPrice = await stripe.prices.retrieve(STRIPE_PRICE_IDS.pro);

  const config = await stripe.billingPortal.configurations.create({
    business_profile: {headline: "Fiftin — gérez votre abonnement"},
    features: {
      invoice_history: {enabled: true},
      payment_method_update: {enabled: true},
      subscription_cancel: {enabled: true, mode: "at_period_end"},
      // Retour utilisateur réel (test du Portail, 5 oct.) : StripeInvalidRequestError
      // "each price in the product's list of available prices must correspond
      // to [ce produit]" — chaque produit ne peut lister QUE son propre prix
      // dans `prices`, jamais celui d'un autre produit (listait par erreur
      // les 2 prix pour chacun des 2 produits). Lister ici 2 PRODUITS
      // distincts (pas 2 prix du même produit) est ce qui fait apparaître le
      // choix Essentiel/Avancé dans le Portail — chacun avec son seul prix.
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: [
          {product: essentielPrice.product, prices: [STRIPE_PRICE_IDS.essentiel]},
          {product: proPrice.product, prices: [STRIPE_PRICE_IDS.pro]},
        ],
      },
    },
  });
  await db.collection("config").doc("stripePortal").set({
    configurationId: config.id,
    createdAt: new Date().toISOString(),
  });
  return config.id;
}

/* Appelée depuis "Réglages → Compte" (bouton "Gérer mon abonnement") :
 * ouvre le Portail Client Stripe — changement de carte, changement de
 * formule, résiliation, factures, tout géré par Stripe lui-même, rien à
 * construire côté Fiftin (cohérent avec les CGV : "pas un logiciel de
 * facturation"). */
exports.createPortalSession = onCall({secrets: [STRIPE_SECRET_KEY]}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const uid = request.auth.uid;

  const accountSnap = await db.collection("accounts").doc(uid).get();
  const billing = accountSnap.exists ? accountSnap.data().billing : null;
  const customerId = billing && billing.stripeCustomerId;
  if (!customerId) throw new HttpsError("failed-precondition", "Aucun abonnement Stripe pour ce compte.");

  const stripe = stripeClient();
  const configurationId = await ensurePortalConfiguration(stripe);
  const returnUrl = (request.data && request.data.returnUrl) || "https://fiftin.fr/app/";
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    configuration: configurationId,
  });
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
    } else if (event.type === "invoice.payment_succeeded") {
      // Retour utilisateur réel (Marine, 1er abonnement) : aucune facture
      // payée automatiquement (Checkout puis chaque renouvellement mensuel)
      // n'envoie d'e-mail de reçu au client — confirmé en lisant la timeline
      // de sa facture dans Stripe, aucune tentative d'envoi n'y figure. Plutôt
      // que de dépendre d'un réglage Dashboard (jamais retrouvé de façon
      // fiable après recherche approfondie dans Facturation/Recouvrement de
      // revenus/Préférences de communication), on déclenche nous-mêmes le
      // même appel que le bouton "Envoyer le reçu" du Dashboard — fonctionne
      // aussi bien sur la 1ère facture (issue de Checkout) que sur chaque
      // renouvellement automatique ensuite, un seul endroit couvre les deux.
      // sendInvoice() rejette si la facture n'a pas d'e-mail client associé
      // (ne devrait jamais arriver ici, email toujours fourni à la création
      // du Customer dans createCheckoutSession) — échec non bloquant pour le
      // reste du webhook, juste loggé.
      const invoice = event.data.object;
      await stripe.invoices.sendInvoice(invoice.id).catch(function (err) {
        console.error("[stripeWebhook] échec de l'envoi du reçu pour la facture " + invoice.id + " :", err.message);
      });
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
exports.enforceFreeProAccounts = onDocumentWritten({document: "accounts/{uid}", region: FIRESTORE_TRIGGER_REGION}, async (event) => {
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

/* ---------------- Calendriers iCal Airbnb / Booking ----------------
 *
 * Import (Airbnb/Booking -> Fiftin) et export (Fiftin -> Airbnb/Booking),
 * par chambre (roomId côté app/). Voir README « Calendriers Airbnb /
 * Booking (iCal) ».
 *
 * Le serveur n'écrit JAMAIS dans accounts/{uid} : ce document est réécrit
 * en entier par l'app à chaque sauvegarde (pushToFirebase), une écriture
 * serveur en parallèle serait écrasée, ou ferait réapparaître des
 * réservations supprimées. Le serveur se contente de télécharger les flux
 * et de ranger leurs séjours dans icalFeeds/{uid}__{roomId}__{platform} ;
 * c'est l'app, à l'ouverture, qui les transforme en réservations
 * (mergeIcalFeeds() côté app/index.html).
 *
 * icalFeeds et icalExportTokens n'ont aucune règle Firestore cliente :
 * tout passe par les fonctions ci-dessous (SDK Admin), aucune règle à
 * coller dans la console. Par défaut, Firestore refuse alors tout accès
 * client direct à ces deux collections — c'est voulu (les liens iCal sont
 * secrets : quiconque les possède voit le calendrier).
 */

const ICAL_FETCH_TIMEOUT_MS = 15000;
const ICAL_MAX_BYTES = 2 * 1024 * 1024;
const ICAL_REFRESH_MIN_MS = 60 * 1000; // anti-rafale du bouton "Synchroniser maintenant"
const ICAL_STALE_MS = 25 * 60 * 1000; // au-delà, l'ouverture de l'app relit les flux

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

function feedDocId(uid, roomId, platform) {
  return [uid, roomId, platform].map(function (x) { return String(x).replace(/[^A-Za-z0-9_-]/g, ""); }).join("__");
}

function requireRoomId(data) {
  const roomId = data && typeof data.roomId === "string" ? data.roomId : "";
  if (!roomId || roomId.length > 100) throw new HttpsError("invalid-argument", "Chambre inconnue.");
  return roomId;
}

/* Téléchargement d'un flux : redirections suivies à la main (3 max) pour
 * revalider le domaine à chaque saut — fetch() les suivrait sinon vers
 * n'importe quelle adresse. Taille et durée plafonnées. */
async function fetchIcalText(platform, url) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const err = ical.validateImportUrl(platform, current);
    if (err) throw new Error(err);
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ICAL_FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {redirect: "manual", signal: ctrl.signal, headers: {"User-Agent": "Fiftin-Calendar/1.0", "Accept": "text/calendar,*/*"}});
    } catch (e) {
      clearTimeout(timer);
      throw new Error("Calendrier injoignable (délai dépassé ou réseau).");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      current = new URL(res.headers.get("location"), current).toString();
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new Error("La plateforme a refusé le lien (erreur " + res.status + "). Vérifiez qu'il est complet et toujours actif.");
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > ICAL_MAX_BYTES) { clearTimeout(timer); throw new Error("Calendrier trop volumineux."); }
    const text = await res.text();
    clearTimeout(timer);
    if (text.length > ICAL_MAX_BYTES) throw new Error("Calendrier trop volumineux.");
    return text;
  }
  throw new Error("Trop de redirections.");
}

/* Relit un flux et met à jour son document. Ne jette jamais : une erreur
 * est enregistrée dans le document (error) sans effacer les derniers
 * séjours connus — un flux momentanément injoignable ne doit pas faire
 * croire à l'app que toutes les réservations ont été annulées. Renvoie
 * true si la liste des séjours a changé. */
async function refreshFeed(ref, feed) {
  const now = new Date().toISOString();
  try {
    const text = await fetchIcalText(feed.platform, feed.url);
    const events = ical.parseIcal(text, feed.platform, todayIsoUtc());
    const changed = JSON.stringify(events) !== JSON.stringify(feed.events || []);
    await ref.set({events: events, eventCount: events.length, lastSyncAt: now, lastOkAt: now, error: null}, {merge: true});
    feed.events = events; feed.lastSyncAt = now; feed.lastOkAt = now; feed.error = null;
    return changed;
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    await ref.set({lastSyncAt: now, error: msg}, {merge: true});
    feed.lastSyncAt = now; feed.error = msg;
    return false;
  }
}

/* Plages bloquées par les calendriers importés d'un compte, par chambre —
 * pour la disponibilité publique (Fiftin Séjours) et pour l'export. Les
 * "block" Airbnb en font partie : des dates fermées sur Airbnb ne sont pas
 * réservables ailleurs non plus. */
async function icalRangesByRoom(uid) {
  const snap = await db.collection("icalFeeds").where("uid", "==", uid).get();
  const out = {};
  snap.forEach(function (doc) {
    const f = doc.data();
    (f.events || []).forEach(function (ev) {
      if (!ev || !ev.start || !ev.end) return;
      (out[f.roomId] = out[f.roomId] || []).push({checkIn: ev.start, checkOut: ev.end});
    });
  });
  return out;
}

function feedForClient(f) {
  return {
    roomId: f.roomId, platform: f.platform, events: f.events || [],
    lastSyncAt: f.lastSyncAt || null, lastOkAt: f.lastOkAt || null, error: f.error || null,
  };
}

/* Enregistre (ou retire, url vide) le lien d'import d'une chambre. Le lien
 * est vérifié en le téléchargeant : on refuse d'enregistrer un lien qui ne
 * renvoie pas un calendrier lisible, plutôt que de le découvrir plus tard. */
exports.icalSetImportUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const uid = request.auth.uid;
  const roomId = requireRoomId(request.data);
  const platform = request.data && request.data.platform;
  if (ical.PLATFORMS.indexOf(platform) === -1) throw new HttpsError("invalid-argument", "Plateforme inconnue.");
  const url = String((request.data && request.data.url) || "").trim();
  const ref = db.collection("icalFeeds").doc(feedDocId(uid, roomId, platform));

  if (!url) {
    await ref.delete();
    return {ok: true, removed: true};
  }
  const urlErr = ical.validateImportUrl(platform, url);
  if (urlErr) throw new HttpsError("invalid-argument", urlErr);

  let events;
  try {
    events = ical.parseIcal(await fetchIcalText(platform, url), platform, todayIsoUtc());
  } catch (e) {
    throw new HttpsError("failed-precondition", String((e && e.message) || e));
  }
  const now = new Date().toISOString();
  const feed = {uid: uid, roomId: roomId, platform: platform, url: url, events: events, eventCount: events.length,
    lastSyncAt: now, lastOkAt: now, error: null, createdAt: now};
  await ref.set(feed);
  const acc = await db.collection("accounts").doc(uid).get();
  await republishAccountAvail(uid, acc.exists ? (acc.data().bookings || []) : []);
  return {ok: true, feed: feedForClient(feed)};
});

/* Séjours importés du compte connecté, pour que l'app les intègre.
 * refresh:true (bouton "Synchroniser maintenant") relit tous les flux
 * tout de suite ; sinon seuls les flux plus vieux que ICAL_STALE_MS sont
 * relus (le passage planifié ci-dessous garde le reste à jour). */
exports.icalGetImports = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const uid = request.auth.uid;
  const force = !!(request.data && request.data.refresh);
  const snap = await db.collection("icalFeeds").where("uid", "==", uid).get();
  const now = Date.now();
  const feeds = [];
  let anyChanged = false;
  await Promise.all(snap.docs.map(async function (doc) {
    const f = doc.data();
    const last = f.lastSyncAt ? Date.parse(f.lastSyncAt) : 0;
    const due = force ? now - last > ICAL_REFRESH_MIN_MS : now - last > ICAL_STALE_MS;
    if (due && await refreshFeed(doc.ref, f)) anyChanged = true;
    feeds.push(feedForClient(f));
  }));
  if (anyChanged) {
    const acc = await db.collection("accounts").doc(uid).get();
    await republishAccountAvail(uid, acc.exists ? (acc.data().bookings || []) : []);
  }
  return {feeds: feeds};
});

/* Lien d'export d'une chambre (à coller dans Airbnb/Booking). Un jeton
 * aléatoire par chambre, conservé tant qu'il n'est pas régénéré
 * (regenerate:true invalide l'ancien lien, si jamais il a fuité). */
exports.icalGetExportUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const uid = request.auth.uid;
  const roomId = requireRoomId(request.data);
  const regenerate = !!(request.data && request.data.regenerate);
  const col = db.collection("icalExportTokens");
  const existing = await col.where("uid", "==", uid).where("roomId", "==", roomId).get();
  let token = null;
  if (!existing.empty && !regenerate) {
    token = existing.docs[0].id;
  } else {
    await Promise.all(existing.docs.map(function (d) { return d.ref.delete(); }));
    token = crypto.randomBytes(24).toString("hex");
    await col.doc(token).set({uid: uid, roomId: roomId, createdAt: new Date().toISOString()});
  }
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "fiftin-e30c2";
  return {url: "https://us-central1-" + project + ".cloudfunctions.net/icalExport/" + token + ".ics"};
});

/* Calendrier public d'une chambre, lu par Airbnb/Booking. Ne contient que
 * des plages de dates (voir ical.buildIcal) : UNIQUEMENT les réservations
 * non annulées enregistrées dans Fiftin — jamais les séjours bruts des
 * calendriers importés. Les y inclure créait une boucle d'écho : une
 * fermeture Airbnb importée, réexportée vers Airbnb, y devenait une
 * fermeture "calendrier externe", que l'export Airbnb renvoyait à son tour
 * à Fiftin… et des dates rouvertes sur Airbnb se refermaient seules, sans
 * fin. Une réservation Airbnb bloque Booking (et inversement) une fois
 * intégrée comme réservation par l'app (mergeIcalFeeds). */
exports.icalExport = onRequest(async (req, res) => {
  const fromPath = String(req.path || "").replace(/^\/+/, "").replace(/\.ics$/i, "");
  const token = String(fromPath || req.query.t || "");
  if (!/^[a-f0-9]{48}$/.test(token)) { res.status(404).send("Not found"); return; }
  const tokSnap = await db.collection("icalExportTokens").doc(token).get();
  if (!tokSnap.exists) { res.status(404).send("Not found"); return; }
  const tok = tokSnap.data();
  const acc = await db.collection("accounts").doc(tok.uid).get();
  const bookings = acc.exists ? (acc.data().bookings || []) : [];
  const today = todayIsoUtc();
  const ranges = bookings
    .filter(function (b) { return b && b.roomId === tok.roomId && b.status !== "no" && typeof b.checkIn === "string" && typeof b.checkOut === "string" && b.checkOut > today; })
    .map(function (b) { return {start: b.checkIn, end: b.checkOut}; });
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Cache-Control", "no-cache, no-store, max-age=0");
  res.status(200).send(ical.buildIcal(ranges));
});

/* Relecture planifiée de tous les flux importés : garde la disponibilité
 * publique à jour même quand l'hôte n'ouvre pas l'app. */
exports.icalScheduledSync = onSchedule({schedule: "every 30 minutes", timeoutSeconds: 300}, async () => {
  const snap = await db.collection("icalFeeds").get();
  const changedUids = {};
  for (const doc of snap.docs) {
    const f = doc.data();
    if (await refreshFeed(doc.ref, f)) changedUids[f.uid] = true;
  }
  for (const uid of Object.keys(changedUids)) {
    const acc = await db.collection("accounts").doc(uid).get();
    await republishAccountAvail(uid, acc.exists ? (acc.data().bookings || []) : []);
  }
});
