# Audit Phase 1 — Protéger Planning avant le chantier Séjours

État au 29/10/2026, lecture du code uniquement (aucune donnée de production lue). Rien n'a été modifié.

## 1. Comment Planning stocke et écrit ses données

**Tout le compte tient dans un seul document Firestore**, `accounts/{uid}` : `bookings`, `guests`, `events`, `cleaning`, `menus`, `extDiners`, `transactions`, `catalog` et `settings` (avec `rooms`, `tariffHistory`, `sources`, `structures`, `icalIgnored`, `onboarding`…).

L'outil le réécrit à chaque sauvegarde (`pushToFirebase`, app/index.html l. 5113). Un envoi remplace chaque champ de premier niveau **en entier** (`mergeFields`). Garde-fous existants :
- aucun envoi avant d'avoir reçu le document du serveur (`remoteReady`) ;
- les Réglages en cours d'édition sont bloqués jusqu'à validation (`settingsDraft`/`commitSettings`) ;
- un compte Personnel ne peut pas écrire.

**Conséquence n°1, structurante pour tout le chantier.** Toute écriture dans `accounts/{uid}` venant d'ailleurs que l'outil (Séjours, une Cloud Function) serait écrasée par la sauvegarde suivante de l'outil : la dernière écriture gagne, sans avertissement. Le README l'a déjà établi pour l'iCal (« Le serveur n'écrit jamais dans `accounts/{uid}` »). Aujourd'hui, Séjours ne fait que **lire** ce document (sejours/index.html l. 10881) ; aucune écriture n'existe. Cette règle doit rester absolue. Tout ce qui va de Séjours vers Planning doit suivre le schéma de l'iCal :
1. un document à part ;
2. l'outil le lit ;
3. l'hôte confirme ;
4. l'outil écrit lui-même.

**Conséquence n°2.** Un document Firestore est limité à 1 Mio. Aucune donnée nouvelle liée à Séjours (photos, textes d'annonce) ne doit entrer dans `accounts/{uid}`.

## 2. Données de Planning concernées

| Donnée | Où | Remarque |
|---|---|---|
| Location | `settings.rooms[]` : `id, name, short, maxPersons, group (structure), description, babyCrib(+Price), noBreakfastService, noDinnerService, icalImports, icalExportUrl, linkedListingId, linkedUnitId` | Capacité = `maxPersons` |
| Tarifs | `rooms[].tariffHistory[]` : versions datées `{from, prices{nbPersonnes: prix}, seasons[], longStay[]}` | Prix par nombre de personnes ; saisons = week-end ou période (en % ou en €) ; remise long séjour en %. Calcul côté outil : `getRoomTariffForDate`, `getRoomPriceForDate` (l. 3744), règles l. 3842-3890 |
| Prix propres à un client, sources sans revenu | `guests`, `settings.sources` | Ne concernent pas un prix public |
| Petit-déjeuner, table d'hôtes | `settings.tariffHistory` (`bf`, `th`, `thExt`), interrupteurs par location | Tarifs globaux |
| Prestations tarifées | `catalog` | |
| Réservations | `bookings[]` : `{roomId, checkIn, checkOut, nbPersons, source, status, groupId, ical…}` | `status:'no'` = annulée. Une réservation par location, reliées par `groupId` |
| iCal | `icalFeeds/*`, `icalExportTokens/*` (serveur seulement) | Importé toutes les 30 min, jamais écrit dans `accounts` |

**Absent de Planning :** durée minimale de séjour, équipements (wifi, parking…), logements dont les disponibilités dépendent les unes des autres (ex. « gîte entier » contre « ses chambres »). Le brief y fait référence en 12.4 et 12.6. Il faudra les ajouter quelque part ou s'en passer (voir les décisions).

## 3. Séjours aujourd'hui

- **Une annonce = un établissement avec plusieurs chambres** : `listings/{id}` porte `units[]` (`id, name, price, maxPersons, gallery*, linkedRoomId`). Le prix et la capacité de l'annonce sont le minimum et le maximum de ses chambres (`listingIndex`).
- **Statuts** : `pending` (déposée, en attente de l'admin) → `published` ↔ `paused`. Un hôte ne peut pas se publier lui-même (règle Firestore). Il n'existe pas de brouillon : le formulaire n'enregistre qu'à la fin.
- **Lien avec Planning : il existe déjà, dans les deux sens.**
  - Côté Séjours : `unit.linkedRoomId`. C'est lui qu'utilise la Cloud Function.
  - Côté Planning : `room.linkedListingId` et `room.linkedUnitId`.
  - Chaque côté nettoie un lien orphelin.
- **Disponibilités publiques** : `listings/{id}/publicAvail/{unitId}`, écrites uniquement par les Cloud Functions.
  - Pour un compte Planning, à chaque sauvegarde de l'outil : réservations non annulées + plages iCal (`syncPublicAvailFromAccount`).
  - Pour un hôte sans Planning, depuis `listings/{id}/bookings` (`syncPublicAvailFromListingBookings`).
  - **Planning est donc déjà la source des disponibilités** pour les chambres liées.
- **Prix public** : `unit.price`, saisi à la main dans Séjours, sans aucun lien avec les tarifs de Planning. Deux sources indépendantes : c'est précisément ce que le brief interdit (11.6).
- **Demandes de voyageurs** : contact WhatsApp, SMS ou appel, journalisé dans `contactLog`. Rien ne crée de réservation, ni dans Planning ni dans Séjours. La règle « une demande ne devient jamais automatiquement une réservation » est respectée aujourd'hui par construction.
- **Recherche de groupe** : `groupedCapacityMatches` regroupe les annonces d'un même propriétaire situées au même endroit (lat/lng arrondis), en additionnant les capacités. **Elle ignore les dates** : c'est la capacité théorique que le brief refuse en 12.4.

## 4. Sauvegardes et environnement de test

- **PITR** (récupération à un instant précis, 7 jours) : le README indique qu'elle a été activée le 20/10/2026. **Je ne peux pas le vérifier d'ici.** À contrôler dans la console Google Cloud → Firestore → Disaster recovery.
- **Pas d'export planifié** de la base. La PITR ne couvre que 7 jours. Une erreur découverte au bout de 8 jours serait irrécupérable, en dehors des exports JSON manuels de l'outil (que seuls les hôtes déclenchent).
- **Restauration jamais testée.**
- **Pas d'environnement de préproduction.** Les émulateurs Firebase fonctionnent (utilisés pour les PR #144 et précédentes), mais aucun test automatique ne tourne dessus. Le seul test automatique du dépôt est `functions/ical.test.js`. Les règles Firestore ont un déploiement protégé (refus si la production a divergé).

## 5. Sources de référence proposées

| Donnée | Référence | Lecture côté Séjours | Modification | Propagation | Si conflit ou hors ligne |
|---|---|---|---|---|---|
| Nom de la location (interne) | Planning | Prérempli une fois à la liaison | Dans chaque outil | Aucune : le titre d'annonce est un texte commercial distinct | Pas de conflit possible |
| Capacité | Planning si liée, sinon Séjours | Projection publique | Planning (lien profond depuis Séjours) | Cloud Function à chaque sauvegarde du compte | Projection non mise à jour → dernière valeur publiée + date de mise à jour |
| Tarifs | Planning si liée, sinon Séjours (`unit.price`) | « À partir de » calculé par le serveur | Planning uniquement | Idem | Idem ; `unit.price` n'est jamais réécrit, il sert seulement de repli |
| Disponibilités | Planning (+ iCal) si liée, sinon `listings/{id}/bookings` | `publicAvail` (existe déjà) | Planning | Existe déjà | Existe déjà |
| Réservations, clients, finances, statistiques | Planning | Jamais exposées | Planning | — | — |
| Prestations tarifées, table d'hôtes | Planning | Affichage indicatif (projection) | Planning | Cloud Function | Idem capacité |
| Photos, ordre, couverture, titre, accroche, description, équipements | Séjours | Directe | Séjours | — | Brouillon local en cas de coupure (voir phase 2) |
| Lien annonce ↔ location | `unit.linkedRoomId` (Séjours) ; le côté Planning n'est qu'un miroir d'affichage | — | L'hôte, des deux côtés | Nettoyage des liens orphelins (existe déjà) | La version Séjours prime, l'autre se corrige |
| Association de logements | Séjours (nouveau champ) | Directe | Séjours | — | — |

**Mécanisme recommandé pour exposer Planning à Séjours.** Les pages publiques ne peuvent pas lire `accounts/{uid}`. Je propose d'étendre la Cloud Function existante `republishAccountAvail` pour qu'elle écrive aussi, à côté de `publicAvail`, une projection publique en lecture seule : capacité, « à partir de », prestations affichables. Aucune écriture nouvelle dans `accounts`, aucun mécanisme de synchronisation en plus, et la fonction tourne déjà à chaque sauvegarde de l'outil.

**Risque technique : le calcul des tarifs existe en un seul exemplaire, dans l'outil.** Le refaire côté serveur crée deux calculs qui peuvent diverger. Parade : un module de calcul pur côté serveur, accompagné d'un test de parité. Ce test compare, sur un jeu de tarifs de démonstration (saisons, week-ends, paliers de personnes, versions datées), le résultat du serveur à celui des fonctions de l'outil exécutées dans un navigateur.

## 6. Conflits entre le brief et l'existant

1. **« Un logement, une annonce » contre les annonces multi-chambres existantes.** Proposition sans migration :
   - les nouvelles annonces ont une seule entrée dans `units[]` ;
   - les Cloud Functions, `publicAvail`, `linkedRoomId`, l'iCal et l'import de la prise en main (PR #144) continuent de fonctionner sans changement ;
   - les annonces multi-chambres existantes restent telles quelles et fonctionnent comme aujourd'hui ;
   - plus tard, une « séparation » proposée à l'hôte, qui crée de nouvelles annonces associées et met l'ancienne en pause. Elle ne supprime jamais rien et n'est jamais automatique.
2. **Les trois états du brief contre la validation par l'admin.** Proposition :
   - `draft` (nouveau, privé, enregistré en continu) ;
   - « Prête à publier », calculé par l'interface et non stocké ;
   - `pending` (« Envoyée, en cours de vérification ») tant que l'admin valide la première publication ;
   - `published` et `paused` inchangés.
   Il faut modifier la règle Firestore : création possible en `draft`, passage `draft` → `pending` par le propriétaire. Le déploiement est protégé et remplace toutes les règles, celles de l'outil comprises.
3. **Modifier une donnée de Planning depuis Séjours (11.5).** La V1 n'écrit rien : le prix ou la capacité touchés dans Séjours ouvrent l'outil directement sur la bonne location (lien profond). Une file de « propositions de modification », appliquées par l'outil après confirmation, est possible ensuite, mais c'est du code en plus dans l'outil en production.
4. **Recherche de groupe avec dates.** Il faut le `publicAvail` de chaque logement associé pour les dates demandées. Le filtre Dates du fil le charge déjà. Protection contre le double comptage : deux annonces liées à la même location Planning comptent pour une seule (dédoublonnage par `linkedRoomId`). Pour les logements interdépendants, aucune donnée n'existe ; il faudra une case « ne se loue pas en même temps que… » ou exclure ces cas en V1.

## 7. Impact sur la prise en main (PR #144, non fusionnée)

- **Étape « locations » de l'assistant.** Elle reprend les chambres Séjours dans Planning, avec liens écrits des deux côtés, groupés par annonce. C'est exactement le 11.2 du brief (récupération à la création, déclenchée par l'hôte, n'écrase rien). Elle reste valable avec une annonce par logement : une annonce équivaut alors à une chambre.
- **Visite guidée.** Aucune bulle ne dépend de Séjours. En phase 3, il faudra ajouter l'indicateur « Connecté à Fiftin Séjours » dans Réglages → Locations, et éventuellement une bulle. Rien à changer avant.
- **Prix.** L'assistant crée les tarifs Planning à partir de `unit.price`, une seule fois, à la création. Ce n'est pas contraire au brief : Planning devient ensuite la référence.

Recommandation : fusionner la PR #144 telle quelle. La phase 3 réutilisera sa logique de reprise.

## 8. Sécurisation proposée avant la phase 2

1. **Vérifier la PITR** (César, console). Si elle est absente, l'activer.
2. **Export planifié quotidien** de Firestore vers un bucket Cloud Storage du projet, avec une durée de conservation de 30 à 90 jours. Jamais vers GitHub : aucune donnée client ne doit y passer. Il peut tourner via un workflow GitHub programmé avec le compte de service existant, mais il lui faut le rôle « Cloud Datastore Import Export Admin » et l'accès au bucket, à ajouter par César. Coût : quelques centimes par mois à ce volume (à confirmer sur la grille tarifaire GCP).
3. **Test de restauration** : réimporter un export dans un projet séparé ou dans l'émulateur, puis comparer le nombre de comptes, réservations et annonces. Que l'émulateur accepte directement un export de production est **à vérifier** ; sinon, il faut un projet Firebase de test vide (gratuit).
4. **Tests de non-régression automatiques** (workflow à chaque PR, émulateurs, données de démonstration uniquement) :
   - **Règles Firestore** : un hôte ne peut pas s'auto-publier ; personne ne peut écrire dans le compte d'un autre ; `publicAvail` est en lecture seule.
   - **Cloud Functions** : projection des disponibilités et des futurs prix, réservations annulées ignorées, iCal (le test existant).
   - **Outil (Playwright)** :
     - ouverture d'un compte existant ;
     - réservation créée, modifiée puis annulée ;
     - tarifs et saisons ;
     - export iCal ;
     - le document du compte n'est ni réduit ni vidé après une session Séjours.
   - **Séjours** : création, modification, pause, liaison et déliaison. La déliaison ne touche jamais Planning.
5. **Retour arrière** : chaque phase est une PR séparée, annulable par « Revert », sans migration. Les champs ajoutés sont simplement ignorés par l'ancien code (même principe que `groupId`). Pour les données, la PITR et l'export.

## 9. Décisions à prendre par César

1. **Annonces multi-chambres existantes** : les garder telles quelles (proposé) ou prévoir une séparation proposée à l'hôte ?
2. **Validation par l'admin** de la première publication : la garder (proposé, c'est une protection anti-abus) ou publier directement une annonce complète ?
3. **Règle du « À partir de »** :
   - minimum sur les 12 prochains mois, pour la capacité minimale ?
   - ou pour 2 personnes ?
   - remise long séjour exclue (proposé) ?
   - petit-déjeuner inclus ou non ?
4. **Modifier un prix ou une capacité depuis Séjours** : lien vers l'outil en V1 (proposé) ou propositions de modification ?
5. **Équipements et durée minimale** : propres à Séjours (proposé ; Planning n'en a pas) ?
6. **Sauvegardes** : vérifier la PITR, puis m'autoriser à préparer l'export quotidien (rôle IAM à ajouter par toi).
