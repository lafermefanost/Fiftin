/* Index public en lots (listingIndexShards/{0..N-1}) : le fil Séjours a
 * besoin de TOUTES les annonces publiées (carte, filtres, tri), mais en
 * lire une par une coûte une lecture Firestore par annonce et par visite
 * (20 000 annonces = 20 000 lectures à chaque visiteur). Les mêmes
 * entrées que listingIndex/{id}, regroupées dans N documents (champ e :
 * {idAnnonce: entrée}) : N lectures par visite, quel que soit le nombre
 * d'annonces. Un document Firestore pèse au plus 1 Mio : à ~600 octets par
 * entrée, 32 lots tiennent ~50 000 annonces — au-delà, augmenter N (la
 * reconstruction suivante répartit tout à nouveau). Tenu à jour à chaque
 * écriture de listingIndex (syncListingIndexShards) et reconstruit en
 * entier toutes les 6 h (rebuildListingIndexShards) ; un lot n'est lu par
 * le site que si tous portent full:true (posé par la reconstruction), sinon
 * le site relit listingIndex comme avant. */
const INDEX_SHARDS = 32;
// FNV-1a puis brassage final (murmur3) : répartition régulière sur N lots.
function shardOf(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % INDEX_SHARDS;
}
/* Répartition complète : entries = [{id, data}] → tableau de N objets {id: data}. */
function distribute(entries) {
  const out = [];
  for (let i = 0; i < INDEX_SHARDS; i++) out.push({});
  entries.forEach(function (e) { out[shardOf(e.id)][e.id] = e.data; });
  return out;
}
/* Entrées d'un lot absentes de la nouvelle répartition (candidates à la suppression). */
function staleKeys(current, next) {
  return Object.keys(current || {}).filter(function (k) { return !Object.prototype.hasOwnProperty.call(next || {}, k); });
}
module.exports = {INDEX_SHARDS, shardOf, distribute, staleKeys};
