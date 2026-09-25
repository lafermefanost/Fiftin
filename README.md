# Fiftin

Outil de planning pour locations courte durée / chambres d'hôtes.

- `index.html` — page de présentation commerciale (fiftin.fr).
- `app/index.html` — l'outil complet (une seule page, pas de build) : fiftin.fr/app/.
- `sejours/index.html` — Fiftin Séjours, l'annuaire de réservation directe pour les voyageurs (nouveau projet, prototype) : fiftin.fr/sejours/.
- Déployé via GitHub Pages sur **fiftin.fr** (voir le fichier `CNAME`).
- Copie initiale de l'outil basée sur `lafermefanost/ferme-fanost/planning.html`, avec la marque renommée « Fifteen » → « Fiftin ».

**Règle de direction artistique : `app/` fait foi.** Pour tout nouvel élément visuel de Séjours (état actif/sélectionné, couleurs, formes), s'inspirer de ce qui existe déjà dans `app/` plutôt que d'inventer — les deux partagent la même palette sous des noms de variables différents (`--green`/`--green-deep` côté app/ = `--sauge`/`--sauge-deep` côté sejours/, mêmes valeurs hexadécimales `#354B38`/`#1D2820`). Exemple concret : l'élément "actif" d'une rangée d'onglets/boutons de vue dans app/ (`.mbnav-btn.on`, `.vtab.on`) passe systématiquement en fond `--green` plein avec texte blanc — jamais fondu avec la page ni en dégradé inventé ; Séjours suit la même convention (`.detail-tab.active`) plutôt que d'improviser un traitement différent.

## Fiftin Séjours (`sejours/`) — annuaire de réservation directe

Projet frère de l'outil de planning, même marque mais codebase et périmètre séparés (voir `CLAUDE.md`) : un annuaire mobile-first pour que les voyageurs trouvent un hébergement et contactent l'hôte directement (WhatsApp, SMS, appel), sans commission ni intermédiaire — dans l'esprit de Cybevasion, en mieux.

- Prototype statique : les annonces sont dans `sejours/listings.json` (pas dans le HTML, voir plus bas), pas de vraies photos partout (dégradés stylisés en attendant).
- À terme : lien avec le calendrier de réservations de l'outil de planning (`app/`), pour que la disponibilité affichée ici soit réelle — pas encore construit.

### Dépôt d'annonce par un hôte (onglet Profil → Espace hôtes)

Un compte connecté (même Firebase Auth que `app/` — voir « Comptes et données » ci-dessous, même projet donc même compte des deux côtés) peut se connecter/s'inscrire directement dans Séjours et déposer une annonce, photos comprises (upload direct vers Firebase Storage). Écrit dans une nouvelle collection Firestore `listings/{id}` avec `status:"pending"` à la création — **jamais publiée automatiquement**.

Une annonce = un établissement (maison d'hôtes, gîte…), pas une chambre : le formulaire recueille une fois les informations communes (nom, description, photos de la maison/espaces communs, prestations) puis une liste de **chambres** (`units`), chacune avec son propre nom, prix, capacité et ses propres photos. Champ Firestore : `listings/{id}.units = [{id, name, price, maxPersons, gallery:[url,...]}]`. Le prix affiché au voyageur (fil, badge, fiche détail) est celui de la chambre la moins chère (« à partir de X € »/« dès X € »), calculé côté client (`normalizeHostListing`) — jamais stocké séparément. Les annonces statiques de `listings.json` n'ont pas de `units` (un seul prix) et continuent de s'afficher normalement : les deux formats cohabitent, tout le code qui lit `l.price`/`l.gallery` accepte les deux.

**Fiche détail côté voyageur, à plusieurs chambres.** Quand une annonce a plus d'une chambre, `openDetail()` affiche des sous-onglets sous le titre — « Vue d'ensemble » (établissement) puis une par chambre (`state.detailTab`, retenu tant qu'on reste sur la même annonce) — plutôt qu'une simple liste statique. Chaque onglet change les photos, les infos affichées et le calendrier :
- **Vue d'ensemble** : toutes les photos (maison + toutes les chambres concaténées), infos établissement (accroche, description, prestations, avis Google), liste des chambres en cartes cliquables (1 clic pour basculer direct sur celle-ci) — **jamais de planning ni de panneau de demande rapide ici**, un établissement à plusieurs chambres n'a pas de planning unique : la carte hôte et la barre de contact (WhatsApp/SMS/appel) restent visibles pour contacter directement, mais le calendrier n'apparaît que dans l'onglet d'une chambre précise.
- **Une chambre** : uniquement ses propres photos (repli sur les photos de la maison si la chambre n'en a pas), son propre prix/capacité, et son propre panneau de demande rapide (calendrier + message pré-rempli mentionnant son nom, via un paramètre optionnel sur `quickReqHtml()`/`wireQuickReq()`/`buildMessage()` — sans rien changer pour l'appel depuis une carte du fil, hors fiche détail, toujours au niveau établissement).

Sur la **carte du fil**, en revanche (avant même d'ouvrir la fiche), toutes les annonces gardent la même structure à deux boutons — « Vérifier la disponibilité » (`coverHtml()`) et « Voir plus » — qu'il y ait une ou plusieurs chambres : pas de cas particulier pour les annonces à plusieurs chambres ici (retour en arrière sur un essai précédent qui masquait le premier bouton dans ce cas). Comme il n'y a pas de planning unique à montrer pour un établissement à plusieurs chambres, ni de planning du tout pour une annonce dont l'hôte n'a pas encore renseigné de créneaux (`l.avail` — voir plus bas, toujours vide sur les annonces réelles, ce système de dates reste une démo non connectée au vrai planning), le calendrier du panneau de demande rapide (`quickReqHtml()`/`calendarHtml()`) bascule alors dans un état « pas de données » plutôt que d'afficher un calendrier normal : `calendarHtml()` détecte `getAvailRanges(l).length===0` et ajoute `.cal-nodata` — les cases passent d'un gris habituel (qui se lirait comme « tout est indisponible ») à un gris très clair (`.cal-nodata .cal-cell{background:var(--cream)}`), et la légende Disponible/Indisponible est remplacée par une phrase invitant à préciser ses dates dans le message. Les champs Arrivée/Départ et le reste du panneau (voyageurs, message pré-rempli, envoi WhatsApp/SMS/appel) restent inchangés et pleinement utilisables dans tous les cas : c'est par eux que le voyageur indique ses dates, calendrier renseigné ou non.

Changer d'onglet conserve la position de scroll (pas besoin de rescroller à chaque fois) ; choisir une chambre depuis sa carte en Vue d'ensemble y bascule directement. Les onglets eux-mêmes reprennent le principe des onglets de navigateur plutôt que des pilules isolées (`.detail-tab`, coins arrondis en haut seulement) : chaque onglet inactif porte sa propre ligne de base grise (séparé du contenu, fond `--cream-deep` discret), l'onglet actif passe en couleur pleine — `--sauge` avec texte `--cream`, même convention que l'élément actif d'une rangée d'onglets/boutons dans app/ (`.mbnav-btn.on`/`.vtab.on`, voir la règle de DA en tête de ce document) — et sa ligne de base disparaît (même couleur que son propre fond) pour se fondre directement dans le contenu juste en dessous : on voit à la fois QUEL onglet est ouvert (couleur) et QU'IL est bien connecté au contenu sous lui (pas de séparation). Les onglets occupent toujours toute la largeur disponible (`.detail-tab{flex:1}`, texte tronqué avec ellipsis si le nom d'une chambre est long) plutôt que de déborder avec un scroll horizontal : autant de chambres, toujours la même largeur totale, répartie à parts égales. Comportement strictement inchangé pour une annonce sans plusieurs chambres (0 ou 1) : aucun onglet, même code qu'avant.

**Carte globale sans contour + cartes blanches à ombre portée, sur la fiche détail.** Reprend le CSS exact de la vue Année de `app/`, pas juste le principe : dans `app/`, chaque structure (`.yr-group` dans `renderYear()`) englobe tous ses sous-encarts (`.tsec-panel`, via le helper `subSection()` — Seuils/Revenus par mois/Top clients/Répartition, chacun `background:var(--white);border-radius:10px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.12)`) — fond blanc sur fond blanc, donc pas de bordure ni d'espace visible entre eux, seule une légère ombre portée les détache du conteneur qui les entoure. Séjours reprend cette structure : `.detail-group` juste sous les onglets englobe TOUT le contenu de l'onglet actif (stats, description, Prestations, Chambres/Créneaux, Votre hôte et même le panneau de demande rapide/calendrier, désormais à l'intérieur, plus à côté) — mais sans bordure : `background:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 2px 8px rgba(0,0,0,.12)`, la même ombre que `.tsec-panel`/`.detail-card`, appliquée au conteneur entier plutôt qu'à chaque sous-encart, pour rester « juste une div blanche qui se détache du fond crème », sans contour visible. Aucune marge entre les onglets et `.detail-group` : quand il y a des onglets, ses coins hauts repassent à 0 (`border-radius:0 0 12px 12px` posé en `style` inline dans `openDetail()`) pour qu'elle démarre exactement là où s'arrête la barre d'onglets — un seul bloc visuel continu, pas deux éléments séparés par un espace. `.detail-card` (= `.tsec-panel` : fond `#fff`, rayon 10px, `margin-bottom:12px`, même ombre, `.detail-card>*:last-child{margin-bottom:0}` pour éviter le double espacement en bas) pour chaque section à l'intérieur. `.host-card` a perdu son fond `--cream-deep` (devenu transparent) pour ne pas empiler une carte dans la carte. `.detail-body` reprend aussi les mêmes marges latérales que `#feed` (11px, au lieu de 20px avant) pour que la fiche détail soit aussi large que les cartes du fil.

**Barre d'onglets du bas visible même fiche détail ouverte.** Avant, ouvrir une fiche détail (« Voir plus ») masquait entièrement `nav.tabbar` (Explorer/Carte/Envies/Profil) derrière l'overlay plein écran `.detail` — seule la flèche retour tout en haut permettait d'en sortir. `nav.tabbar` garde son z-index habituel (50, sous les sheets/modales à 150 et sous `.detail` à 200 — ordre inchangé sur tous les autres écrans, espace hôte compris) SAUF quand `body` porte la classe `detail-open` (posée par `openDetail()`, retirée par `closeDetail()`) : `body.detail-open nav.tabbar{z-index:220}` la fait alors passer au-dessus de `.detail`, ciblé à ce seul état pour ne pas passer devant une sheet ouverte ailleurs dans l'app. `.detail-contact-bar` (WhatsApp/SMS/Appeler) est repoussée d'autant par une variable CSS `--tabbar-h:calc(64px + env(safe-area-inset-bottom,0px))` (`bottom:var(--tabbar-h)` au lieu de `bottom:0`) pour se caler juste au-dessus de la barre d'onglets plutôt que de la recouvrir — les deux barres restent empilées et cliquables. Cliquer un onglet pendant que la fiche est ouverte referme celle-ci au passage (`switchTab()` appelle `closeDetail()` si `state.detailListingId` est renseigné) avant de basculer sur l'onglet visé — Explorer ramène ainsi naturellement sur le fil.

**Cases indisponibles barrées, sur le calendrier de demande rapide.** Même case grise qu'avant (`#E2DFD8`), avec en plus une fine ligne diagonale (`linear-gradient(135deg, ...)` en `background-image`, superposé au `background` uni) pour que ce soit plus immédiat à lire. Ciblé précisément : `.cal:not(.cal-nodata) .cal-cell:not(.avail):not(.empty)` — ni les cases disponibles (`.avail`, vert sauge), ni les cases de remplissage vide de début de mois (`.empty`), ni, surtout, un calendrier en mode « pas de données » (`.cal-nodata`, voir plus bas) : une case sans barre diagonale peut y sembler disponible, mais une case BARRÉE dans ce mode-là affirmerait à tort « indisponible » alors qu'on n'en sait rien — la ligne diagonale reste donc réservée aux vraies données d'indisponibilité.

**Site personnel + fiche Google Business, jusqu'au bout de la chaîne.** Le lien « Voir les avis sur Google » existait déjà dans `openDetail()` (`l.googleUrl`), mais rien ne permettait à un hôte de le renseigner : ni champ dans le hostform, ni mapping dans `normalizeHostListing()` — un vrai trou, invisible avec les données de démo (`listings.json` porte le champ en dur pour certaines annonces statiques) mais bloquant pour toute annonce réelle créée via le site. Chemin reconstruit de bout en bout : deux champs optionnels `hf-website`/`hf-google` dans le hostform (juste après le téléphone) → `websiteUrl`/`googleUrl` dans le payload de `submitHostForm()` (toujours envoyés, y compris vides, pour qu'effacer le champ efface bien la valeur enregistrée) → mappés dans `normalizeHostListing()` (`l.websiteUrl||""`, `l.googleUrl||""`) pour le fil public → rendus dans `openDetail()` sous un même conteneur `.ext-links` (`display:flex;flex-wrap:wrap`, remplace l'ancienne marge négative pensée pour un seul lien) : « Voir le site » (icône globe) puis « Voir les avis sur Google » (icône étoile), chacun seulement si renseigné, rien du tout si aucun des deux. La pré-lecture pour « Modifier l'annonce » passe par un autre chemin (`ensureHostListingsLoaded()`, données Firestore brutes, pas `normalizeHostListing()`) mais utilise les mêmes noms de champs, donc aucun mapping supplémentaire n'y était nécessaire.

**Diagnostic : « la page saute » en revenant sur Explorer.** Signalé par l'hôte, avec le soupçon d'une image trop lourde. Mesuré avec l'API Layout Instability (Chrome) : la cause réelle n'a rien à voir avec des images (`.cover` réserve déjà sa taille via `aspect-ratio`, les photos ne peuvent pas faire bouger la mise en page en chargeant) — c'est `switchTab()` qui masquait `#filter-bar`/`#result-line` avec l'attribut `hidden` (`display:none`, ~87px de haut à eux deux) sur l'onglet Profil, et les remontrait d'un coup en revenant sur Explorer : `#feed` (juste en dessous, réutilisé pour Explorer/Carte/Envies/Profil, voir `renderProfile()`) sautait alors instantanément de 87px dans la même frame, sans transition — un vrai décalage mesuré (CLS≈0.10 sur `#feed`), pas une impression. Corrigé en remplaçant `hidden` par une classe `.chrome-collapsed` (`max-height`/`opacity`/`padding` animés en ~200ms sur `.filters` et `.result-line`, `overflow-y:hidden` ajouté à `.filters` qui garde son `overflow-x:auto` pour le défilement horizontal des chips) partout où c'était basculé (`switchTab()` et `enterHostMode()`) : le même décalage de hauteur a toujours lieu (Profil n'affiche logiquement pas de filtres), mais il se voit glisser sur ~200ms au lieu de sauter d'un coup. Bien penser à toucher les DEUX call sites si ce mécanisme est retouché : `enterHostMode()` posait encore `hidden=true` sans jamais le retirer nulle part ailleurs, ce qui aurait bloqué `#filter-bar`/`#result-line` en `display:none` de façon permanente après le premier passage en espace hôte si seul `switchTab()` avait été corrigé.

Le calendrier de l'Espace hôtes (Mon calendrier, voir plus bas) est lui aussi par chambre : chaque `unit` a son propre statut lecture seule/simplifié, son propre lien vers une chambre `app/` (`unit.linkedRoomId`), et les réservations de la sous-collection `listings/{id}/bookings` portent un champ `unitId` pour savoir à quelle chambre elles appartiennent.

#### Valider (publier) une annonce déposée — depuis Séjours, compte admin

Onglet **Profil → Annonces à valider** (visible uniquement pour le ou les comptes listés dans `ADMIN_EMAILS`, voir `sejours/index.html`, et dans la fonction `isAdmin()` des règles Firestore ci-dessous — **les deux listes doivent rester identiques**, sinon l'interface montre le bouton mais Firestore refuse l'action, ou inversement).

Liste des annonces en attente (photo, nom, région, prix, distance, qui l'a déposée), avec deux boutons :
- **Publier** : passe `status` à `"published"` — l'annonce apparaît **automatiquement** dans le fil public de Séjours dès le prochain chargement de la page par un visiteur (le fil fusionne au chargement les annonces statiques de `listings.json` et les annonces Firestore publiées). Rien à faire ailleurs, ni redéploiement ni fichier à modifier.
- **Refuser** : supprime définitivement l'annonce.

Comptes admin confirmés : `lafermefanost@gmail.com` et `cesarmarandin@gmail.com` (les deux comptes de César). Comparaison insensible à la casse des deux côtés (JS et règles Firestore), Gmail/Firebase n'imposant pas de casse fixe sur l'e-mail. Pour ajouter/retirer un compte admin plus tard : modifier `ADMIN_EMAILS` dans `sejours/index.html` **et** la fonction `isAdmin()` des règles Firestore ci-dessous — les deux listes doivent rester identiques.

#### Photos — Firebase Storage

Le formulaire de dépôt permet maintenant l'upload de photos (6 maximum, 8 Mo chacune), stockées sous `listings/{uid}/...` dans Firebase Storage, avec l'URL de chaque photo dans le champ `gallery` du document Firestore correspondant.

**Point de vigilance réel, pas juste administratif : Firebase Storage nécessite le forfait Blaze (paiement à l'usage) du projet Google Cloud — impossible à activer sur le forfait gratuit Spark.** Ça ne veut pas dire que ça va coûter cher (le forfait Blaze inclut lui-même un palier gratuit généreux — 5 Go de stockage, 1 Go de téléchargement par jour), mais ça veut dire qu'une carte bancaire doit être renseignée sur le projet Google Cloud sous-jacent, même si l'usage réel reste dans le gratuit. À vérifier/activer : Firebase Console → Build → Storage → « Get started » (le assistant de configuration demande explicitement de passer sur Blaze si ce n'est pas déjà fait).

Règles de sécurité Storage à coller (Firebase Console → Build → Storage → Rules — **différent de l'onglet Firestore Database → Règles**, un système de règles séparé) :

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /listings/{uid}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid
        && request.resource.size < 8 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

Lecture publique (les photos doivent être visibles par n'importe quel visiteur de l'annuaire), écriture réservée au propriétaire du dossier (`uid` = son identifiant Firebase), taille et type de fichier vérifiés côté serveur en plus du contrôle déjà fait côté application.

**Sans le forfait Blaze activé ET ces règles collées, l'upload de photos échoue** (à l'activation de Storage, ou à l'écriture selon lequel des deux manque) — non vérifiable depuis l'environnement de développement (accès réseau à Firebase bloqué), donc c'est le premier vrai dépôt d'annonce avec photos qui validera que tout est branché correctement.

#### Paiement et choix de formule à l'inscription

Aucun paiement réel : Stripe n'est pas branché (voir « À faire avant un vrai passage en production » — pas encore fait non plus pour `app/`, la création d'entreprise est en cours). En revanche, l'architecture des 3 formules existe et est fonctionnelle, purement déclarative en attendant Stripe (comme `S.settings.plan` l'est déjà côté `app/`) :

Sur le parcours hôte de Séjours (Devenir hôte / Espace hôtes, jamais sur l'inscription générale d'un simple voyageur — voir `authContext` dans `sejours/index.html`), l'inscription propose un choix de formule :
- **Simple annonce** (gratuit) : ne crée rien de plus qu'un compte Firebase Auth. Comportement inchangé, calendrier simplifié en lecture/écriture (`listings/{id}/bookings`).
- **Gestion simplifiée** (24 €/mois) ou **Gestion avancée** (47 €/mois) : juste après la création du compte Firebase Auth, `sejours/index.html` écrit un tout premier document `accounts/{uid}` avec `settings.plan` déjà positionné (`'essentiel'` ou `'pro'`, mêmes valeurs qu'`app/`) — un `.set()` sur un uid que Firebase Auth vient de générer dans le même appel, donc un document garanti inexistant avant cet instant : aucun risque d'écraser une donnée réelle (voir `bootstrapHostAccount()`). L'hôte bascule alors automatiquement en « compte gestion » (lecture seule sur son calendrier, voir plus bas), même s'il n'a encore jamais ouvert `app/`.

Ce mécanisme ne s'applique qu'à une inscription neuve. Se connecter à un compte existant (le sien, ou celui de quelqu'un d'autre) ne déclenche jamais cette écriture, quelle que soit la formule affichée — aucun chemin de code ne le permet.

### Filtres du fil (Lieu / Distance / Prestations / Trier) — refonte, vague 1

Demande initiale en 4 points ; seuls les points sans dépendance externe sont construits pour l'instant (voir plus bas ce qui reste bloqué et pourquoi).

**Lieu, à 3 niveaux (région → département → mot-clé libre), combinables.** `FR_REGIONS` (nouvelle constante) est le référentiel complet des 13 régions métropolitaines + 5 régions/DROM d'outre-mer et leurs départements — volontairement exhaustif, pas seulement les régions où il y a déjà des annonces (l'ancien comportement, `regions.reduce()` sur `LISTINGS`, donnait un filtre pauvre tant que peu d'hôtes avaient déposé une annonce). `state.filters` gagne deux champs structurés, `regionName`/`deptName`, désormais indépendants du mot-clé libre `f.q` — avant, une seule variable (`f.q`) servait aux deux usages, ce qui empêchait par exemple de combiner "Occitanie" ET "Wissous". `matchesLocation(l, f)` centralise le matching : un `regionName`/`deptName` structuré (nouveau, voir le hostform ci-dessous) matche exactement ; à défaut, sous-chaîne insensible à la casse dans l'ancien champ libre `region` — et pour une RÉGION spécifiquement, le nom de **n'importe lequel de ses départements** est aussi essayé contre ce champ libre, pas seulement le nom officiel de la région : une annonce existante dit presque toujours son département ou sa ville ("Luberon, Vaucluse"), jamais le nom bureaucratique de la région ("Provence-Alpes-Côte d'Azur") — sans ce repli, aucune annonce plus ancienne ne matcherait jamais une région choisie. Le hostform gagne deux `<select>` optionnels (Région, puis Département filtré dynamiquement sur la région choisie — `deptOptionsHtml()`/`deptsForRegion()`) et un champ libre Ville/quartier/rue (`city`), stockés tels quels (`regionName`, `deptName`, `city`) et lus par `normalizeHostListing()` pour le fil public ; le champ "Localisation" existant (`region`, affiché aux voyageurs) n'est pas touché.

**Prestations groupées par catégorie.** Même liste `ALL_AMENITIES` (aucune donnée à migrer), nouveau regroupement `AMEN_GROUPS` (Vue / Loisirs & bien-être / Extérieur & ambiance / Équipement / Accueil) rendu par un helper partagé `amenityGroupsHtml(isActive)`, utilisé à la fois par le volet filtre et par le formulaire de dépôt/édition — un seul endroit qui décide du découpage par catégorie plutôt que deux grilles plates dupliquées.

### Filtres, vague 2/3 — distance réelle (adresse + géolocalisation) et favoris globaux

Les deux points laissés bloqués en vague 1 sont construits.

**Adresse par annonce, géocodée, distance recalculée en direct.** Le champ hostform « Distance depuis la Ferme Fanost (km) » (un nombre saisi à la main) est remplacé par « Adresse complète du logement », **obligatoire** — au dépôt/à la modification, `geocodeAddress(address)` interroge l'API publique et gratuite **Nominatim** (OpenStreetMap, pas de clé, pas de coût — contrairement à l'API Géocodage Google) et stocke les coordonnées obtenues (`lat`/`lng`) sur l'annonce ; adresse introuvable/mal formée → message d'erreur actionnable, rien n'est envoyé (`btn.textContent` passe par "Localisation de l'adresse…" pendant l'appel). Plus aucune distance n'est stockée telle quelle sur une annonce désormais : `listingDistanceKm(l)` la recalcule à CHAQUE rendu (badge du fil, tri, filtre, fiche détail) depuis `currentOrigin()` — soit `state.geoOrigin` (la position réelle du voyageur, activée via le bouton dédié, voir plus bas), soit, par défaut, `DEFAULT_ORIGIN` (les coordonnées de la Ferme Fanost elle-même, même repère implicite qu'avant ce chantier). Une annonce plus ancienne sans coordonnées (jamais réenregistrée depuis) retombe sur son ancien `distance` fixe — dégradation propre, rien ne casse. `haversineKm()` existait déjà (zone de recherche dessinée à la main sur la carte, `mapZoneFilteredListings()`) : réutilisée telle quelle, pas redéclarée.

**"Utiliser ma position", mis en avant dans le volet Lieu.** Bouton en tout premier (avant même Région), parce qu'il change la référence de TOUTES les distances affichées sur le fil, pas seulement ce volet. `navigator.geolocation.getCurrentPosition()` — refus/erreur affiché en clair (permission refusée vs position indisponible), jamais silencieux. Position **jamais persistée** (pas dans `localStorage`, contrairement au reste de `state`) : redemandée à chaque session, plus respectueux de la vie privée qu'un consentement mémorisé indéfiniment. Un bouton "Revenir à la position par défaut" apparaît une fois activée, pour revenir à `DEFAULT_ORIGIN` sans re-râfraîchir la page.

**Trier : "Les plus appréciés" ajouté, entre distance et prix — like réel, compte requis.** Première version (voir historique) : compteur `likeCount` incrémenté sans exiger de compte — un vrai risque d'abus (script anonyme), assumé puis reconsidéré. Reconstruit sur un modèle plus solide : **AJOUTER un favori exige désormais un compte** (`toggleLike()` ouvre la connexion — `openSheet("auth")` — au lieu de liker si le visiteur n'est pas connecté), et le like devient un document par (annonce, compte) dans `listings/{id}/likes/{uid}` plutôt qu'un simple compteur — `writeLikeState()` écrit ce document ET incrémente/décrémente `likeCount` dans le **même batch** (`db.batch()`), atomique : jamais l'un sans l'autre. RETIRER un favori reste possible sans connexion, y compris un ancien favori local ajouté anonymement avant ce changement (aucune purge rétroactive, seul l'ajout est bloqué) — mais dans ce cas rien n'est écrit côté serveur (`writeLikeState()` n'est appelée que si `authState.uid` existe). Une annonce statique de démo (`listings.json`, pas de `docId`, voir `normalizeHostListing()`) reste "aimable" localement sans jamais toucher Firestore, il n'y a pas de document à incrémenter. **Nécessite la règle Firestore `listings/{listingId}` étendue ci-dessous (compteur + sous-collection `likes`) — sans elle la fonctionnalité échoue silencieusement.** Le document `likes/{uid}` fait foi : la règle du compteur n'autorise +1 que si ce document vient d'être créé et -1 que s'il vient d'être supprimé (`exists()`/`existsAfter()`) — un double-like (même personne, deux appareils) ne peut donc pas gonfler le compteur, contrairement à la première version. Reste un vrai compte requis pour l'abus le plus grossier, pas une protection absolue contre des comptes jetables créés en masse — pas de solution complète sans App Check ou Cloud Function, absentes de ce projet.

**Distance : texte corrigé, maintenant honnête.** Le libellé "Rayon autour de vous" (vague 1 l'avait neutralisé en "Distance maximale", faute d'un vrai calcul) redevient exact maintenant que la distance est réellement recalculée depuis la position du voyageur ou, par défaut, la Ferme Fanost.

**Point d'attention, pas un bug — à trancher si besoin :** les annonces statiques de démonstration (`listings.json` : Le Mas des Lavandes, La Bergerie de Cassagne, Villa Belle Île) portaient déjà de vraies coordonnées GPS (pour la fonctionnalité carte existante), mais un ancien champ `distance` fictif, sans rapport avec leur position réelle, à des centaines de kilomètres de la Ferme Fanost (Luberon, Cévennes, Presqu'île de Quiberon). Avec la distance désormais réellement calculée, ces trois annonces démo sortent du rayon par défaut (100 km, plafond du curseur) et **n'apparaissent plus dans le fil tant que le voyageur n'active pas sa position ou ne recherche pas cette région précisément** — comportement mécaniquement correct (une annonce à 650 km ne devrait pas apparaître par défaut), mais un vrai changement visible pour qui connaissait la démo. Les annonces réelles déposées jusqu'ici (Essonne) ne sont pas concernées. À signaler si la démo doit rester "tout est proche" par construction — pas tranché ici.

## Comptes et données — architecture définitive

Fiftin est multi-comptes : chaque client crée son propre compte (e-mail + mot de passe) et ne voit jamais les données d'un autre compte.

- **Connexion** : Firebase Authentication (e-mail + mot de passe). Pas encore de « Se connecter avec Google » — ajoutable plus tard sans rien casser.
- **Stockage** : un seul projet Firebase, centralisé, géré par nous, héberge tous les comptes clients. Chaque propriétaire a son propre document Firestore (`accounts/{uid}`, `uid` = l'identifiant unique attribué par Firebase Authentication à la connexion).
- **Isolation réelle des données** : ce n'est pas seulement le code JS qui empêche un compte de voir les données d'un autre — ce sont les **règles Firestore côté serveur** (voir ci-dessous) qui refusent toute lecture/écriture hors de son propre document, quel que soit le client utilisé pour se connecter.
- **Poste partagé** : à la déconnexion, les données locales de l'appareil (localStorage) sont effacées immédiatement, pour qu'aucune trace du compte précédent ne reste visible à la personne suivante.
- **Mot de passe oublié** : un lien « Mot de passe oublié ? » envoie un e-mail de réinitialisation via Firebase.
- **Changer de mot de passe** : Réglages → Compte.

## Formules — Essentiel / Pro

`S.settings.plan` (`'essentiel'` par défaut, ou `'pro'`) est **purement déclaratif pour l'instant** : changeable librement dans Réglages → Compte, en attendant le vrai paiement en ligne (Stripe, à venir). Ça sert déjà à essayer les deux formules et à en démontrer la différence :

- **Essentiel** : une seule structure juridique.
- **Pro** : structures juridiques illimitées (SASU, LMNP, EIRL, micro-foncier, EI…), chacune avec ses propres plafonds — et l'accès Équipe (voir ci-dessous).

## Accès Équipe (« Personnel ») — formule Pro

Un propriétaire peut inviter des comptes à droits limités (ex. femme de ménage) : accès uniquement aux vues **Grille**, **Jour**, **Ménage** (déjà inclus dans les deux vues précédentes) et **Événements** — jamais les chiffres, les réglages, les transactions bancaires ni le fichier client détaillé.

**Comment ça marche :**
- Réglages → Équipe → « Générer un lien d'invitation » crée un lien à usage unique (`fiftin.fr/app/?invite=...`), à envoyer soi-même (SMS, WhatsApp…) à la personne à inviter.
- La personne invitée ouvre le lien, crée son propre compte (son propre e-mail/mot de passe) — elle est alors rattachée au propriétaire (`accountMembers/{uid}`), jamais l'inverse : ouvrir le lien en étant déjà connecté à un compte existant, ou se connecter au lieu de s'inscrire, ne change jamais rien à ce compte-là.
- Réglages → Équipe liste les membres actifs ; « × » retire l'accès à tout moment.

**Séparation réelle des données (pas juste à l'écran) :** un compte Personnel ne reçoit jamais le document principal du propriétaire (`accounts/{uid}`). Il lit uniquement un sous-document miroir, `accounts/{uid}/shared/ops`, que le propriétaire seul écrit après chaque synchro, et qui ne contient que réservations/clients/ménage/événements/chambres — jamais réglages, seuils fiscaux, structures ou transactions bancaires. Un compte Personnel est en **lecture seule** (v1) : toute tentative d'écriture est bloquée côté application ET côté règles Firestore.

**Limite connue** : un lien d'invitation utilisé deux fois en même temps (fenêtre de quelques millisecondes) pourrait, dans le pire des cas, créer deux comptes Personnel au lieu d'un — un risque de facturation mineur (un siège Personnel de plus que prévu), pas un risque de sécurité des données. À corriger plus tard si besoin avec une transaction Firestore.

### Règles Firestore à appliquer (Firebase Console → Firestore Database → Règles)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Comptes autorisés à valider/refuser les annonces déposées sur
    // Fiftin Séjours (Profil → Annonces à valider). À TENIR IDENTIQUE à
    // ADMIN_EMAILS dans sejours/index.html — les deux listes doivent
    // toujours contenir les mêmes adresses (en minuscules ici : .lower()
    // rend la comparaison insensible à la casse de l'e-mail réel).
    function isAdmin(){
      return request.auth != null && request.auth.token.email.lower() in ['lafermefanost@gmail.com', 'cesarmarandin@gmail.com'];
    }

    match /accounts/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      match /shared/ops {
        allow read: if request.auth != null && (
          request.auth.uid == uid ||
          (exists(/databases/$(database)/documents/accountMembers/$(request.auth.uid)) &&
           get(/databases/$(database)/documents/accountMembers/$(request.auth.uid)).data.ownerUid == uid)
        );
        allow write: if request.auth != null && request.auth.uid == uid;
      }
    }

    match /accountMembers/{memberUid} {
      allow read: if request.auth != null && (
        request.auth.uid == memberUid || resource.data.ownerUid == request.auth.uid
      );
      allow create: if request.auth != null && request.auth.uid == memberUid
        && request.resource.data.ownerUid is string
        && request.resource.data.inviteId is string
        && get(/databases/$(database)/documents/invites/$(request.resource.data.inviteId)).data.ownerUid == request.resource.data.ownerUid;
      allow update: if false;
      allow delete: if request.auth != null && resource.data.ownerUid == request.auth.uid;
    }

    match /invites/{inviteId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.ownerUid == request.auth.uid;
      allow update: if request.auth != null
        && resource.data.used == false
        && request.resource.data.used == true
        && request.resource.data.usedBy == request.auth.uid
        && request.resource.data.ownerUid == resource.data.ownerUid;
      allow delete: if request.auth != null && resource.data.ownerUid == request.auth.uid;
    }

    // Annonces déposées par les hôtes depuis Fiftin Séjours (onglet Profil
    // → Espace hôtes). Public en lecture uniquement une fois publiée ; le
    // dépôt force status:"pending" (un hôte ne peut pas s'auto-publier) ;
    // seul un compte isAdmin() peut faire passer status à "published" ou
    // supprimer une annonce d'un autre compte (Profil → Annonces à valider).
    match /listings/{listingId} {
      allow read: if resource.data.status == 'published'
        || (request.auth != null && resource.data.ownerUid == request.auth.uid)
        || isAdmin();
      allow create: if request.auth != null
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.status == 'pending';
      allow update: if isAdmin()
        || (request.auth != null
          && resource.data.ownerUid == request.auth.uid
          && request.resource.data.status == resource.data.status)
        // Compteur global de favoris (bouton cœur, Fiftin Séjours) : un
        // like exige désormais un compte (voir toggleLike() — plus
        // d'écriture anonyme) et likeCount ne peut bouger que de pair avec
        // le document listings/{listingId}/likes/{request.auth.uid} qui
        // fait foi (voir plus bas) : monter de +1 exige que CE document
        // vienne d'être créé (n'existait pas avant, existe après), et
        // descendre de -1 qu'il vienne d'être supprimé (existait avant,
        // n'existe plus après). Un double-like (même personne, deux
        // appareils, ou double-écriture) ne peut donc pas gonfler le
        // compteur : le document ne peut passer qu'une fois d'un état à
        // l'autre. resource.data.get('likeCount', 0) tolère une annonce
        // plus ancienne qui n'a pas encore ce champ. Reste un vrai compte
        // requis pour l'abus le plus grossier (script anonyme), pas une
        // protection absolue contre des comptes jetables créés en masse —
        // il n'y a pas d'App Check ni de Cloud Function dans ce projet
        // pour aller plus loin.
        || (
          request.auth != null
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['likeCount'])
          && (
            (request.resource.data.likeCount == resource.data.get('likeCount', 0) + 1
              && !exists(/databases/$(database)/documents/listings/$(listingId)/likes/$(request.auth.uid))
              && existsAfter(/databases/$(database)/documents/listings/$(listingId)/likes/$(request.auth.uid)))
            || (request.resource.data.likeCount == resource.data.get('likeCount', 0) - 1
              && exists(/databases/$(database)/documents/listings/$(listingId)/likes/$(request.auth.uid))
              && !existsAfter(/databases/$(database)/documents/listings/$(listingId)/likes/$(request.auth.uid)))
          )
        );
      allow delete: if isAdmin()
        || (request.auth != null && resource.data.ownerUid == request.auth.uid);

      // Un document par (annonce, compte) qui a liké — la vraie source de
      // vérité derrière likeCount ci-dessus (voir son commentaire). Chacun
      // ne peut créer/supprimer QUE son propre document (id = son uid) :
      // impossible de liker au nom de quelqu'un d'autre, et le document
      // étant unique par uid, un double-like ne crée jamais un deuxième
      // enregistrement. Pas de update : on crée ou on supprime, jamais on
      // modifie un like existant.
      match /likes/{uid} {
        allow read: if request.auth != null;
        allow create, delete: if request.auth != null && request.auth.uid == uid;
        allow update: if false;
      }

      // Calendrier simplifié d'une annonce (Espace hôtes → Mon calendrier),
      // utilisé pour les hôtes "compte simple annonce" (pas de document
      // accounts/{uid}) : juste un nom de client + des dates, jamais de
      // données comptables. Lecture/écriture réservées au propriétaire de
      // l'annonce parente. Les hôtes "compte gestion" (accounts/{uid}
      // existe) ne passent jamais par cette sous-collection : Séjours lit
      // accounts/{uid} en lecture seule pour eux (règle accounts/{uid}
      // ci-dessus, déjà limitée au propriétaire) et n'y écrit jamais rien.
      match /bookings/{bookingId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/listings/$(listingId)).data.ownerUid == request.auth.uid;
      }
    }
  }
}
```

Cette règle dit : un document `accounts/XXXX` n'est lisible/modifiable que par la personne connectée dont l'identifiant Firebase est `XXXX` (le propriétaire) — sauf le sous-document `shared/ops`, également lisible par un compte Personnel qui lui est officiellement rattaché. Personne d'autre, même avec la configuration Firebase en main, ne peut y accéder. Pour `listings/{listingId}`, seul le propriétaire (`ownerUid`) peut créer/modifier/supprimer son annonce, tout le monde peut lire une annonce `published`, et personne côté application ne peut faire passer `status` de `pending` à `published` (règle `update` : le nouveau `status` doit rester égal à l'ancien) — cette bascule se fait uniquement à la main dans la Firebase Console. Le champ `linkedRoomId` (Espace hôtes → Mon calendrier, voir plus bas) est un champ comme un autre pour cette règle : le propriétaire peut le modifier librement tant que `status` ne bouge pas.

**Important : sans ce nouveau bloc `listings/{listingId}` (bookings inclus) collé dans Firebase Console → Firestore Database → Règles, le dépôt d'annonce et le calendrier hôte échouent silencieusement avec une erreur de permission** — les règles Firestore refusent par défaut tout ce qui n'est pas explicitement autorisé.

### Espace hôtes : calendrier simplifié (Profil → Espace hôtes)

Depuis l'onglet Profil, un hôte connecté qui clique sur « Espace hôtes » bascule toute l'application dans un mode hôte : la barre d'onglets affiche **Mes annonces** / **Mon calendrier** / **Espace voyageur** (retour), le bandeau de filtres disparaît. « Mon calendrier » reprend la mise en page de la vue Location de `app/` — rangée Année/Aujourd'hui/Action en haut, 12 mini-mois par 2 avec numéros de semaine dans une carte blanche détachée du fond (`.cal-card`, même principe que `.rv-calendar` côté app/) — pour **une chambre à la fois** : si l'annonce sélectionnée a plusieurs chambres (`units`), une pagination « n / total » avec flèches (au lieu d'un simple menu déroulant) permet de passer de l'une à l'autre — chaque chambre a son propre statut, son propre lien vers `app/` et ses propres réservations.

Cases disponibles grises, case occupée dans une seule couleur — même principe que `.rv-day-cell`/`var(--light)` côté app/, sans reproduire le code couleur par source de réservation (Airbnb/Booking/direct…) de l'app : Séjours reste en lecture seule, une seule couleur "occupé" suffit. La grise (`#E2DFD8`) reprend exactement la valeur `--light` de l'app. Le vert utilisé pour "occupé" est `--sauge` (`#354B38`), pas `--sauge-deep` (`#1D2820`) : ce dernier, à la taille d'une case de calendrier, se voit comme du noir plutôt que comme du vert — repéré en usage réel (« les cases occupées sont noires, pas vertes »), corrigé pour rester dans la palette Séjours tout en étant effectivement lisible comme un vert.

Même traitement (fond gris `#E2DFD8`, carte blanche, `--sauge`/`--sauge-deep` au lieu du jaune) appliqué au **second calendrier de Séjours** — celui, bien plus petit, de la « demande rapide » (`calendarHtml`/`.cal-cell`, sur chaque fiche d'annonce, un seul mois à la fois pour choisir arrivée/départ) : composant distinct de « Mon calendrier » (classes différentes, code différent, fonction différente — visualiser l'année entière contre choisir des dates précises), mais qui gagne la même identité visuelle grise/sauge plutôt que son ancien jaune. Sa propre sémantique (case colorée = date sélectionnable pour une demande, grise = non) reste inchangée : seules les couleurs changent, pas le sens.

Deux catégories d'hôtes, déterminées par l'existence du document `accounts/{uid}` — pas un choix par annonce ni par chambre, et pas de palier gratuit à distinguer côté `app/` (`settings.plan` vaut `'essentiel'` ou `'pro'`, les deux sont payants ; l'existence même du document suffit donc à qualifier un « compte gestion ») :

- **Compte simple annonce** (pas de document `accounts/{uid}`) : Séjours est le seul outil de planning de cet hôte. Lecture/écriture complète par chambre, réservations stockées dans `listings/{listingId}/bookings/{bookingId}` (`unitId`, `name`, `checkIn`, `checkOut`) — taper une case libre ouvre nom du client + dates pour la chambre affichée, taper une case occupée propose de la supprimer. C'est le mode « je n'ai que des hébergements, je veux un outil très simple ».
- **Compte gestion** (`accounts/{uid}` existe) : Séjours passe en **lecture seule**. Un sélecteur « Afficher les réservations de » (une chambre parmi `accounts/{uid}.settings.rooms`) permet, pour la chambre Séjours affichée, d'indiquer à quelle chambre `app/` elle correspond (`unit.linkedRoomId`) et d'afficher à titre indicatif ses dates déjà occupées côté `app/` — pour éviter un double-emploi visuel — mais aucune case n'est éditable ni supprimable depuis Séjours, et le bouton d'ajout est remplacé par un lien vers `app/`. **Aucune écriture vers `accounts/{uid}` n'existe nulle part dans `sejours/index.html`** : ni `.set()`, ni `.update()`, ni `arrayUnion`/`arrayRemove` — c'est une garantie structurelle (le code n'a tout simplement pas ce chemin), pas une précaution au cas par cas, précisément parce qu'`accounts/{uid}` porte les données réelles de planning d'un client payant et que `app/` lui-même fait un `.set()` plein document à chaque synchro (`pushToFirebase()`) : n'importe quelle écriture concurrente y créerait un risque de course inutile.

Ce lien (`unit.linkedRoomId`) n'a plus besoin d'attendre l'écran calendrier : si l'hôte est un compte gestion, chaque chambre du formulaire de dépôt/édition (`renderHostUnits`) propose directement un sélecteur « Relier à une chambre de votre Fiftin app » (rempli depuis `accounts/{uid}.settings.rooms`, lu une seule fois via `resolveHostAccount()` — le même appel en lecture seule que pour le calendrier, aucun nouveau chemin d'écriture). Le sélecteur n'apparaît que si le compte a des chambres `app/` à proposer ; un compte simple annonce ne le voit jamais. Choisir une chambre reprend son prix/nuit actuel (dernière entrée de `tariffHistory`, à la capacité de la chambre) et sa capacité comme point de départ dans les champs Séjours — l'hôte reste libre de les retoucher ensuite, rien n'est reversé automatiquement par la suite.

**Nettoyage des liens caducs (dans les deux sens) :** un lien n'est jamais une garantie de suppression en cascade — supprimer une chambre côté `app/` (`delRoom`) ne touche jamais `listings/*`, et supprimer une chambre ou une annonce côté Séjours ne touche jamais `accounts/{uid}` (voir plus haut, garantie structurelle). Ça laisse en revanche le champ de lien lui-même caduc (`unit.linkedRoomId` côté Séjours, `room.linkedListingId`/`linkedUnitId` côté `app/`) pointer sur quelque chose qui n'existe plus — inoffensif (rien ne plante, aucune réservation n'est affectée) mais jamais nettoyé tout seul avant ce correctif. `pruneStaleLinkedRoomIds()` (Séjours, appelée à l'ouverture du calendrier hôte et du formulaire d'édition) et `pruneStaleRoomLinks()` (`app/`, appelée à l'ouverture des Paramètres) détectent un lien qui ne correspond plus à rien et le réinitialisent — jamais le reste de la chambre (nom/prix/capacité/tarifs), uniquement le champ de lien.

### Modifier une annonce existante

Une annonce déposée sans chambre (`units` vide) affichait auparavant un calendrier bloqué sur « Cette annonce n'a pas encore de chambre » sans aucun moyen d'en ajouter une. Trois points d'entrée ouvrent maintenant le même formulaire de dépôt en **mode édition** (`hostFormEditListing` pointe vers l'annonce concernée au lieu de `null`) :

- Le bouton « Modifier l'annonce pour en ajouter une » affiché directement sur cet écran de calendrier bloqué.
- Le bouton « Modifier » sur chaque carte de « Mes annonces ».
- Depuis « Mes annonces » → « + Nouvelle annonce » repasse bien en mode création (`hostFormEditListing = null`), tout comme le bouton « Espace hôtes » de la nav et l'écran vide de l'espace hôtes.

En mode édition, le formulaire est pré-rempli (nom, description, prestations, chambres avec leurs photos) et le bouton d'envoi fait un `.update()` sur le document existant au lieu d'un `.add()` — `status`, `ownerUid` et `createdAt` sont volontairement absents du payload envoyé, donc jamais réécrits (la règle Firestore `status` immuable côté hôte reste respectée par construction, sans code dédié pour la faire respecter).

Les photos déjà en ligne ne sont ni re-uploadées ni perdues : chaque entrée de photo (maison ou chambre) est `{type:"existing", url}` ou `{type:"new", file}` dans le même tableau, que ce soit en création ou en édition. À l'envoi, `resolvePhotoEntries()` sépare les deux, n'uploade que les `"new"`, puis recompose la liste finale dans l'ordre d'origine — modifier une annonce sans toucher aux photos d'une chambre laisse son `gallery` strictement inchangé.

**Recadrage carré manuel + compression avant envoi.** La même photo s'affiche à deux ratios différents selon l'endroit du site — carte du fil en 4/5 (portrait), fiche détail en ~5/4 (paysage) — tous deux obtenus aujourd'hui par un `object-fit:cover` centré, qui rogne à l'aveugle sans respecter le sujet de la photo. Plutôt que de produire deux recadrages distincts par photo (doublerait le stockage et la bande passante Storage, à l'opposé du but recherché), chaque nouvelle photo choisie (maison ou chambre) ouvre un recadreur carré (`#crop-overlay`, `cropAndCompressFiles()`/`cropOneFile()`) : un cadre carré, glissable et zoomable, démarre centré sur la photo (même cadrage que l'ancien comportement automatique, donc rien ne change si l'hôte ne touche à rien) et affiche en direct deux petits aperçus — un en 4/5, un en 5/4 — de ce que donnerait ce cadrage dans chacun des deux contextes (recalculés à partir du même état de glisser/zoom, sans générer ni stocker de fichier supplémentaire). À la validation, le carré cadré est recompressé en JPEG qualité 0.85 (`CROP_OUTPUT_SIZE` = 1600px maximum). « Garder telle quelle » saute le recadrage et retombe sur `compressImageFile()` (redimensionnement à 1920px sur le plus grand côté, ratio d'origine conservé, même recompression) — c'est aussi le filet de secours automatique si l'image ne peut pas être décodée dans le recadreur. Plusieurs photos choisies d'un coup sont traitées une par une (jamais en parallèle) pour ne montrer qu'un cadrage à la fois. Dans tous les cas, le résultat reste un `File` classique (renommé `.jpg`) : `resolvePhotoEntries()`/`uploadPhotoFiles()` n'ont rien à savoir de ce qui s'est passé avant.

### Créer une chambre `app/` à partir d'une annonce Séjours existante

Symétrique au sélecteur ci-dessus, dans l'autre sens : dans `app/`, « + Ajouter une chambre » (`addRoom()`) lit désormais (`resolveSejoursListings()`, lecture seule sur `listings` où `ownerUid == uid` — même règle Firestore que le propriétaire lisant sa propre annonce, y compris `pending`) les chambres Séjours de l'hôte pas encore reprises (`roomAddChoiceEntries()`, qui exclut celles déjà associées via `room.linkedListingId`/`linkedUnitId`). S'il y en a, une modale (`modalRoomAdd`) propose de reprendre l'une d'elles (nom, capacité, prix repris comme tarif de base) ou de repartir d'une chambre vierge ; **s'il n'y en a aucune, `addRoom()` crée directement une chambre vierge, exactement comme avant** — aucun changement de comportement pour un compte sans présence sur Séjours.

Reprendre une chambre passe par `addRoomFromListingUnit()`, qui pousse dans `S.settings.rooms` exactement comme `addRoom()` le faisait déjà (même écriture `saveSettings()`/`pushToFirebase()`, inchangée) puis appelle `writeBackSejoursLink()` : celle-ci écrit `unit.linkedRoomId` sur l'annonce Séjours d'origine (même mécanisme que le sens Séjours→app ci-dessus — tout le tableau `units` réécrit, jamais `status`/`ownerUid`/`createdAt`), pour que le calendrier Séjours de cette chambre affiche directement les réservations de la chambre app sans étape manuelle en plus. **Sans cette écriture retour, le lien restait à sens unique** : la chambre app savait qu'elle venait de cette chambre Séjours (`linkedListingId`/`linkedUnitId`), mais le calendrier Séjours, lui, ne voyait toujours aucun lien — bug réel repéré en usage (calendrier Séjours affiché comme "non relié" malgré une chambre correctement reprise côté app). `roomAddChoiceEntries()` exclut aussi une chambre déjà reliée dans l'autre sens (`unit.linkedRoomId` déjà posé côté Séjours), pour ne jamais la reproposer et créer un second lien concurrent. Testé via Playwright (mock Firebase hors-ligne) : proposition correcte pour un compte avec des chambres Séjours non reprises, chambre déjà reprise (dans un sens comme dans l'autre) jamais reproposée, écriture retour au bon format (`linkedRoomId` sur la seule chambre concernée), et — le point critique — comportement strictement identique à avant (chambre vierge immédiate, aucune modale, aucune écriture) pour un compte sans aucune annonce Séjours.

## À faire avant un vrai passage en production

- Paiement en ligne (Stripe) — essai gratuit 15 jours, puis abonnement réel.
- Étendre l'export/import JSON à l'ensemble des réglages (aujourd'hui seuls réservations/clients/événements sont couverts).
- Parcours de démarrage pour un nouveau compte (aujourd'hui on atterrit sur une grille vide avec des chambres génériques).
- Vérification d'e-mail à l'inscription (pas encore demandée).
- « Se connecter avec Google » (pas encore ajouté, volontairement, pour garder le premier lancement simple).
- Mentions légales, CGU/CGV, politique de confidentialité (page de présentation commerciale).
