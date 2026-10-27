/* Rattrapage des photos déjà en ligne (Fiftin Séjours).
 *
 * Ajoute, à côté de chaque photo existante, les versions qui lui manquent :
 *   - affichage 1280 px de large  → « <photo>__mid.jpg »   (galleryMid[])
 *   - miniature 480 px            → « <photo>__thumb.jpg » (galleryThumb[])
 * pour les annonces (galerie de l'établissement et de chaque chambre) et
 * une miniature pour les photos d'hôte (hostProfiles.photoThumbUrl,
 * listings.hostPhotoThumbUrl).
 *
 * Strictement additif : aucun fichier existant n'est modifié ni supprimé,
 * aucun autre champ n'est touché. Une annonce modifiée par son hôte pendant
 * le traitement est laissée de côté (vérifié dans une transaction).
 * Rejouable sans risque : ce qui existe déjà est réutilisé.
 *
 * Mode lu dans scripts/backfill-photos.mode :
 *   simulation  → rien n'est écrit ; rapport (nombres, poids estimés sur un
 *                 échantillon, droits du compte de service) ;
 *   application → écrit les nouveaux fichiers et les nouveaux champs.
 * Lancé par .github/workflows/backfill-photos.yml (push sur main). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");
const sharp = require("sharp");

const PROJECT_ID = process.env.BACKFILL_PROJECT || "fiftin-e30c2"; // BACKFILL_PROJECT : tests sur émulateur uniquement
const MID_WIDTH = 1280;
const THUMB_MAX = 480;
const QUALITY = 85;
const MODE = fs.readFileSync(path.join(__dirname, "backfill-photos.mode"), "utf8").trim();
if (MODE !== "simulation" && MODE !== "application") {
  console.error("Mode inconnu : « " + MODE + " » (attendu : simulation ou application).");
  process.exit(1);
}
const APPLY = MODE === "application";

admin.initializeApp({projectId: PROJECT_ID});
const db = admin.firestore();

function parseStorageUrl(url) {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?#]+)/.exec(url || "");
  if (!m) return null;
  try { return {bucket: m[1], name: decodeURIComponent(m[2])}; } catch (e) { return null; }
}
// Même contrôle que isPhotoVariantOf() côté client (sejours/index.html).
function isVariantOf(variantUrl, fullUrl, tag) {
  const v = parseStorageUrl(variantUrl), f = parseStorageUrl(fullUrl);
  if (!v || !f) return false;
  return v.name === f.name + "__" + tag + ".jpg" || (v.name.indexOf("-" + tag + "-") >= 0 && v.name.replace("-" + tag + "-", "-") === f.name);
}
function downloadUrl(bucket, name, token) {
  return "https://firebasestorage.googleapis.com/v0/b/" + bucket + "/o/" + encodeURIComponent(name) + "?alt=media&token=" + token;
}

const stats = {listings: 0, listingsChanged: 0, listingsSkipped: 0, profiles: 0, profilesChanged: 0,
  photos: 0, midNeeded: 0, midNotNeeded: 0, thumbNeeded: 0, hostThumbNeeded: 0, created: 0, reused: 0, errors: 0};
const sample = [];               // poids réels mesurés (simulation)
const SAMPLE_MAX = 6;
const sourceCache = new Map();   // url plein format -> {buf, width}
const variantCache = new Map();  // url plein format + tag -> url de la variante

async function loadSource(fullUrl) {
  if (sourceCache.has(fullUrl)) return sourceCache.get(fullUrl);
  const loc = parseStorageUrl(fullUrl);
  if (!loc) throw new Error("URL de stockage non reconnue");
  const [buf] = await admin.storage().bucket(loc.bucket).file(loc.name).download();
  const meta = await sharp(buf).rotate().metadata();
  // .rotate() sans argument : orientation EXIF appliquée, comme le navigateur à l'affichage.
  const oriented = (meta.orientation || 1) >= 5;
  const entry = {buf, width: oriented ? meta.height : meta.width, loc};
  sourceCache.set(fullUrl, entry);
  if (sourceCache.size > 20) sourceCache.delete(sourceCache.keys().next().value);
  return entry;
}
function render(src, tag) {
  const img = sharp(src.buf).rotate();
  return (tag === "mid" ? img.resize({width: MID_WIDTH, withoutEnlargement: true})
    : img.resize({width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true}))
    .jpeg({quality: QUALITY}).toBuffer();
}

/* URL de la variante (créée si besoin en mode application) ; null en
   simulation ou si la photo est déjà assez petite (mid inutile). */
async function ensureVariant(fullUrl, tag) {
  const key = fullUrl + "|" + tag;
  if (variantCache.has(key)) return variantCache.get(key);
  const src = await loadSource(fullUrl);
  if (tag === "mid" && src.width <= MID_WIDTH) { stats.midNotNeeded++; variantCache.set(key, null); return null; }
  if (tag === "mid") stats.midNeeded++; else stats.thumbNeeded++;
  const bucket = admin.storage().bucket(src.loc.bucket);
  const name = src.loc.name + "__" + tag + ".jpg";
  if (!APPLY) {
    if (sample.length < SAMPLE_MAX) {
      const out = await render(src, tag);
      sample.push({tag, avant: src.buf.length, apres: out.length});
    }
    variantCache.set(key, null);
    return null;
  }
  const file = bucket.file(name);
  const [exists] = await file.exists();
  let token;
  if (exists) {
    const [meta] = await file.getMetadata();
    token = meta.metadata && meta.metadata.firebaseStorageDownloadTokens && meta.metadata.firebaseStorageDownloadTokens.split(",")[0];
    if (!token) { token = crypto.randomUUID(); await file.setMetadata({metadata: {firebaseStorageDownloadTokens: token}}); }
    stats.reused++;
  } else {
    token = crypto.randomUUID();
    const out = await render(src, tag);
    await file.save(out, {resumable: false, contentType: "image/jpeg",
      metadata: {cacheControl: "public, max-age=31536000", metadata: {firebaseStorageDownloadTokens: token}}});
    stats.created++;
  }
  const url = downloadUrl(src.loc.bucket, name, token);
  variantCache.set(key, url);
  return url;
}

/* Nouvelles galleryMid/galleryThumb pour un objet portant gallery[] ;
   null si rien ne change. Les variantes valides déjà présentes sont gardées. */
async function variantsFor(o) {
  const gallery = o.gallery || [];
  if (!gallery.length) return null;
  const mids = gallery.map((u, i) => (o.galleryMid && isVariantOf(o.galleryMid[i], u, "mid")) ? o.galleryMid[i] : null);
  const thumbs = gallery.map((u, i) => (o.galleryThumb && isVariantOf(o.galleryThumb[i], u, "thumb")) ? o.galleryThumb[i] : null);
  let changed = false;
  for (let i = 0; i < gallery.length; i++) {
    const full = gallery[i];
    if (!full || !parseStorageUrl(full)) continue;
    stats.photos++;
    try {
      if (!mids[i]) { const m = await ensureVariant(full, "mid"); if (m) { mids[i] = m; changed = true; } }
      if (!thumbs[i]) { const t = await ensureVariant(full, "thumb"); if (t) { thumbs[i] = t; changed = true; } }
    } catch (e) { stats.errors++; console.log("  ! photo " + (i + 1) + " : " + e.message); }
  }
  return changed ? {galleryMid: mids, galleryThumb: thumbs} : null;
}
async function hostThumbFor(fullUrl, currentThumb) {
  if (!fullUrl || !parseStorageUrl(fullUrl) || isVariantOf(currentThumb, fullUrl, "thumb")) return null;
  stats.hostThumbNeeded++;
  try { return await ensureVariant(fullUrl, "thumb"); } catch (e) { stats.errors++; console.log("  ! photo d'hôte : " + e.message); return null; }
}
function galleriesKey(d) {
  return JSON.stringify([d.gallery || [], (d.units || []).map((u) => u.gallery || []), d.hostPhotoUrl || ""]);
}

async function processListing(doc) {
  stats.listings++;
  const d = doc.data();
  const update = {};
  const top = await variantsFor(d);
  if (top) Object.assign(update, top);
  let unitsChanged = false;
  const unitVariants = [];
  for (const u of d.units || []) {
    const v = await variantsFor(u);
    unitVariants.push(v);
    if (v) unitsChanged = true;
  }
  const hostThumb = await hostThumbFor(d.hostPhotoUrl, d.hostPhotoThumbUrl);
  if (hostThumb) update.hostPhotoThumbUrl = hostThumb;
  if (!APPLY || (!Object.keys(update).length && !unitsChanged)) return;
  const before = galleriesKey(d);
  const ok = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    if (!fresh.exists || galleriesKey(fresh.data()) !== before) return false; // modifiée entre-temps : on n'y touche pas
    const write = Object.assign({}, update);
    if (unitsChanged) {
      write.units = (fresh.data().units || []).map((u, i) => unitVariants[i] ? Object.assign({}, u, unitVariants[i]) : u);
    }
    tx.update(doc.ref, write);
    return true;
  });
  if (ok) { stats.listingsChanged++; console.log("  annonce " + doc.id + " : complétée"); }
  else { stats.listingsSkipped++; console.log("  annonce " + doc.id + " : modifiée pendant le traitement, laissée telle quelle"); }
}

async function processProfile(doc) {
  stats.profiles++;
  const d = doc.data();
  const t = await hostThumbFor(d.photoUrl, d.photoThumbUrl);
  if (!APPLY || !t) return;
  const ok = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    if (!fresh.exists || fresh.data().photoUrl !== d.photoUrl) return false;
    tx.update(doc.ref, {photoThumbUrl: t});
    return true;
  });
  if (ok) stats.profilesChanged++;
}

async function checkStorageRights(bucketName) {
  try {
    const [perms] = await admin.storage().bucket(bucketName).iam.testPermissions(["storage.objects.get", "storage.objects.create"]);
    console.log("Droits du compte de service sur " + bucketName + " : lecture " + (perms["storage.objects.get"] ? "oui" : "NON") +
      ", écriture " + (perms["storage.objects.create"] ? "oui" : "NON"));
  } catch (e) { console.log("Droits de stockage non vérifiables : " + e.message); }
}

(async function main() {
  console.log("Mode : " + MODE + (APPLY ? " (écriture)" : " (aucune écriture)"));
  const listings = await db.collection("listings").get();
  const profiles = await db.collection("hostProfiles").get();
  console.log(listings.size + " annonce(s), " + profiles.size + " profil(s) d'hôte.");
  const firstUrl = listings.docs.map((x) => x.data().gallery && x.data().gallery[0]).find((u) => parseStorageUrl(u));
  if (firstUrl) await checkStorageRights(parseStorageUrl(firstUrl).bucket);
  for (const doc of listings.docs) {
    try { await processListing(doc); } catch (e) { stats.errors++; console.log("  ! annonce " + doc.id + " : " + e.message); }
  }
  for (const doc of profiles.docs) {
    try { await processProfile(doc); } catch (e) { stats.errors++; console.log("  ! profil : " + e.message); }
  }
  console.log("=== Bilan ===");
  console.log("Photos examinées : " + stats.photos);
  console.log("Versions 1280 px à créer : " + stats.midNeeded + " (déjà assez petites : " + stats.midNotNeeded + ")");
  console.log("Miniatures à créer (fichiers distincts) : " + stats.thumbNeeded);
  console.log("Photos d'hôte sans miniature (annonces + profils) : " + stats.hostThumbNeeded);
  if (APPLY) {
    console.log("Fichiers créés : " + stats.created + ", déjà présents réutilisés : " + stats.reused);
    console.log("Annonces complétées : " + stats.listingsChanged + ", laissées (modifiées entre-temps) : " + stats.listingsSkipped);
    console.log("Profils complétés : " + stats.profilesChanged);
  } else if (sample.length) {
    console.log("Échantillon (poids réels, Ko) :");
    sample.forEach((x) => console.log("  " + x.tag + " : " + Math.round(x.avant / 1024) + " → " + Math.round(x.apres / 1024)));
  }
  console.log("Erreurs : " + stats.errors);
  if (stats.errors) process.exitCode = 1;
})().catch((e) => { console.error("Échec : " + e.message); process.exit(1); });
