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

- Prototype statique : les annonces sont dans `sejours/listings.json` (pas dans le HTML, voir plus bas — désormais vide, voir plus bas « Nettoyage »), pas de vraies photos partout (dégradés stylisés en attendant).
- Lien avec le calendrier de réservations de l'outil de planning (`app/`), pour que la disponibilité affichée ici soit réelle : construit, voir « Disponibilité réelle côté voyageur » plus bas — **nécessite un déploiement Cloud Functions que toi seul peux faire** (`firebase deploy --only functions`), pas encore actif tant que ce n'est pas fait.

### Dépôt d'annonce par un hôte (onglet Profil → Espace hôtes)

Un compte connecté (même Firebase Auth que `app/` — voir « Comptes et données » ci-dessous, même projet donc même compte des deux côtés) peut se connecter/s'inscrire directement dans Séjours et déposer une annonce, photos comprises (upload direct vers Firebase Storage). Écrit dans une nouvelle collection Firestore `listings/{id}` avec `status:"pending"` à la création — **jamais publiée automatiquement**.

Une annonce = un établissement (maison d'hôtes, gîte…), pas une chambre : le formulaire recueille une fois les informations communes (nom, description, photos de la maison/espaces communs, prestations) puis une liste de **chambres** (`units`), chacune avec son propre nom, prix, capacité et ses propres photos. Champ Firestore : `listings/{id}.units = [{id, name, price, maxPersons, gallery:[url,...]}]`. Le prix affiché au voyageur (fil, badge, fiche détail) est celui de la chambre la moins chère (« à partir de X € »/« dès X € »), calculé côté client (`normalizeHostListing`) — jamais stocké séparément. Les annonces statiques de `listings.json` n'ont pas de `units` (un seul prix) et continuent de s'afficher normalement : les deux formats cohabitent, tout le code qui lit `l.price`/`l.gallery` accepte les deux.

**Fiche détail côté voyageur, à plusieurs chambres.** Quand une annonce a plus d'une chambre, `openDetail()` affiche des sous-onglets sous le titre — « Vue d'ensemble » (établissement) puis une par chambre (`state.detailTab`, retenu tant qu'on reste sur la même annonce) — plutôt qu'une simple liste statique. Chaque onglet change les photos, les infos affichées et le calendrier :
- **Vue d'ensemble** : toutes les photos (maison + toutes les chambres concaténées), infos établissement (accroche, description, prestations, avis Google), liste des chambres en cartes cliquables (1 clic pour basculer direct sur celle-ci) — **jamais de planning ni de panneau de demande rapide ici**, un établissement à plusieurs chambres n'a pas de planning unique : la carte hôte et la barre de contact (WhatsApp/SMS/appel) restent visibles pour contacter directement, mais le calendrier n'apparaît que dans l'onglet d'une chambre précise.
- **Une chambre** : uniquement ses propres photos (repli sur les photos de la maison si la chambre n'en a pas), son propre prix/capacité, et son propre panneau de demande rapide (calendrier + message pré-rempli mentionnant son nom, via un paramètre optionnel sur `quickReqHtml()`/`wireQuickReq()`/`buildMessage()` — sans rien changer pour l'appel depuis une carte du fil, hors fiche détail, toujours au niveau établissement).

Sur la **carte du fil**, en revanche (avant même d'ouvrir la fiche), toutes les annonces gardent la même structure à deux boutons — « Contact et disponibilités » (`coverHtml()`, ex-« Vérifier la disponibilité ») et « Voir plus » — qu'il y ait une ou plusieurs chambres : pas de cas particulier pour les annonces à plusieurs chambres ici (retour en arrière sur un essai précédent qui masquait le premier bouton dans ce cas). Comme il n'y a pas de planning unique à montrer pour un établissement à plusieurs chambres, ni de planning du tout pour une annonce dont l'hôte n'a pas encore renseigné de créneaux (`l.avail` — voir plus bas, toujours vide sur les annonces réelles ; une démo non connectée au vrai planning quand rien de réel n'a encore été publié pour la chambre concernée — voir « Disponibilité réelle côté voyageur » plus bas pour le cas où ça l'a été), le calendrier du panneau de demande rapide (`quickReqHtml()`/`calendarHtml()`) bascule alors dans un état « pas de données » plutôt que d'afficher un calendrier normal : `calendarHtml()` détecte `getAvailRanges(l).length===0` et ajoute `.cal-nodata` — les cases passent d'un gris habituel (qui se lirait comme « tout est indisponible ») à un gris très clair (`.cal-nodata .cal-cell{background:var(--cream)}`), et la légende Disponible/Indisponible est remplacée par une phrase invitant à préciser ses dates dans le message. Les champs Arrivée/Départ et le reste du panneau (voyageurs, message pré-rempli, envoi WhatsApp/SMS/appel) restent inchangés et pleinement utilisables dans tous les cas : c'est par eux que le voyageur indique ses dates, calendrier renseigné ou non.

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

**Point d'attention, pas un bug — tranché :** les annonces statiques de démonstration (`listings.json` : Le Mas des Lavandes, La Bergerie de Cassagne, Villa Belle Île) portaient déjà de vraies coordonnées GPS (pour la fonctionnalité carte existante), mais un ancien champ `distance` fictif, sans rapport avec leur position réelle, à des centaines de kilomètres de la Ferme Fanost (Luberon, Cévennes, Presqu'île de Quiberon). Avec la distance désormais réellement calculée, ces trois annonces démo sortaient du rayon par défaut (100 km, plafond du curseur) et n'apparaissaient plus dans le fil sans activer sa position ou rechercher précisément ces régions — un vrai changement visible pour qui connaissait la démo, ayant mené au nettoyage ci-dessous.

### Nettoyage : suppression de toutes les annonces statiques de démonstration

`sejours/listings.json` est désormais un tableau vide (`[]`). Les quatre annonces qui y vivaient — Le Mas des Lavandes, La Bergerie de Cassagne, Villa Belle Île, **et Le Petit Fanost** — ont été retirées, y compris cette dernière bien que réelle (la propre chambre de la Ferme Fanost, avec vraies photos et lien Google) : elle n'était encore qu'une entrée statique dans un fichier JSON, jamais un vrai document Firestore créé via le formulaire de dépôt d'annonce, donc pas conforme au principe retenu ici — **toute annonce affichée doit être hébergée par un vrai compte**, sans exception, y compris pour la ferme elle-même. Le Petit Fanost sera redéposé par son propriétaire via le vrai formulaire hôte (Espace hôtes), sur son compte réel `lafermefanost@gmail.com` — pas restauré tel quel dans ce fichier.

Le fil public de Séjours n'affiche donc plus, pour l'instant, que les annonces réellement déposées et publiées via Firestore (`listings/{id}`, `status:"published"`) — `rebuildListings()` continue de fusionner `listings.json` (vide) et Firestore sans traitement spécial : le code du chemin "annonce statique" (pas de `docId`, pas de `units`, `avail` fixe non connecté au vrai planning) reste fonctionnel et n'a pas été retiré, seul son contenu de démonstration a été vidé — réutilisable si une vraie raison de remettre du contenu statique apparaît plus tard (ex. un fichier YAML éditorial distinct des vraies annonces), mais ce n'est plus le cas aujourd'hui.

### Refonte visuelle : barre d'onglets, calendrier, contact, carte, favoris, partage, type d'hébergement

**Barre d'onglets du bas : encart carré façon icône d'appli, vert sauge.** Repris de `app/` (`.mbnav-btn.on`, fond `--green` plein sur l'onglet sélectionné) mais ajusté : dans `app/`, le fond colore tout le bouton (icône + libellé), un rectangle qui suit la largeur flex du bouton — jamais carré. Ici, un nouvel élément `.tab-icon` (34×34px fixe, `border-radius:10px`) enveloppe uniquement le pictogramme ; le libellé reste en dehors, coloré seul (`.tab.active{color:var(--sauge-deep)}`), plus proche d'une icône d'app mobile (carré + légende sous l'icône, pas dans un bloc coloré). Couleur : `--sauge` (#354B38, le vert sauge "propriétaire" — mêmes valeurs que `--green` dans `app/`), pas `--sauge-mid` (le "vert moyen", utilisé ailleurs, voir bouton WhatsApp ci-dessous).

**Calendrier de demande rapide : disponible en vert acide, pas vert foncé.** `.cal-cell.avail` passe de `--sauge` à `--yellow` (la teinte chartreuse/vert-jaune déjà utilisée par `.btn.primary`, le bouton "Contact et disponibilités" — même couleur, même langage visuel entre le bouton qui ouvre le calendrier et les cases qu'il révèle). Texte remis en `--sauge-deep` sur ces cases (pas `--cream`) : blanc sur `--yellow` serait quasi illisible (contraste ~1.3:1). Case sélectionnée (`--sauge-deep`) et puce de légende changée pareil.

**Boutons de contact (WhatsApp/SMS/Appeler) recolorés, fond plein + texte blanc.** Avant : fonds pastel avec texte teinté foncé (`#e9f3ea`/`#2f5c33`, etc.). Maintenant : WhatsApp en `--sauge-mid` (le vert moyen propriétaire) texte blanc, SMS en `--lavender` (la lavande propriétaire, #7B94E8 — pas `--lavender-bg` ni `--lavender-deep`, réservées ailleurs) texte blanc. **Écart assumé sur le bouton Appeler** : demandé en `--yellow` + texte blanc comme les deux autres, mais `--yellow` est trop clair pour du texte blanc lisible (contraste ~1.3:1, sous le minimum AA de 4.5:1 — un `.send-btn.call` avec du texte blanc dessus serait pratiquement illisible). Le bouton reste en fond `--yellow`, mais avec un texte `--sauge-deep` (même choix que `.btn.primary`, qui utilise déjà cette combinaison pour la même raison). À dire si un fond blanc/texte foncé est préféré à la place — mais pas de fond `--yellow` + texte blanc lisible possible sans changer la couleur elle-même.

**Bouton "Contact et disponibilités"** (`.btn.primary` du fil) — renommé, ex-"Vérifier la disponibilité". Comportement inchangé (ouvre le panneau `.qr-panel` sur place).

**Carte : clic sur une annonce → sa carte apparaît sous la carte, plus de plein écran.** Avant, cliquer une punaise ou un item de `.map-list` ouvrait `openDetail()` (fiche plein écran par-dessus la carte). Maintenant, `selectMapListing(id)` mémorise l'annonce choisie (`mapSelectedId`) et `renderMapSelectedCard()` affiche, dans un nouveau conteneur `#map-selected` juste sous `.map-canvas`, la **même carte que le fil** (`coverHtml()` réutilisé tel quel : photo, nom, prix, cœur, partage, "Contact et disponibilités"/"Voir plus") — sans recréer l'instance Leaflet (pas de perte de zoom/pan). "Voir plus" depuis cette carte ouvre bien la fiche plein écran comme avant, si vraiment souhaité. Sélection remise à zéro en quittant l'onglet Carte (`switchTab()`). `refreshCurrentView()` (nouveau) remplace l'appel direct à `renderFeed()` après un like : sur la carte, il rafraîchit seulement `#map-selected` au lieu d'écraser toute la vue.

**Cœur liké : jaune/vert acide, plus rouge.** `.save-btn.liked svg` passe de `--danger` à `--yellow`. Non touché : la punaise "aimée" sur la carte (`.map-pin.liked`), qui reste en `--danger` — son fond sert aussi de repère au prix affiché en `--yellow` par-dessus (`.map-pin .dot span`), passer les deux en `--yellow` aurait rendu ce texte invisible (jaune sur jaune).

**Partage.** Nouveau bouton rond (icône de partage à 3 nœuds) juste sous le cœur, sur la carte du fil et sur la fiche détail (`shareListing()`). Utilise `navigator.share()` sur mobile (partage natif), et sinon copie un lien dans le presse-papiers (`navigator.clipboard.writeText`, avec repli sur `prompt()` si indisponible). Le lien partagé est un **lien profond** (`?listing=<id>`) qui rouvre directement la fiche de cette annonce précise au chargement (`maybeOpenDeepLink()`, appelée après le chargement de `listings.json` et après celui de Firestore — la plupart des annonces réelles n'existent que côté Firestore, qui répond après le fichier statique).

**Pictogrammes de type d'hébergement, en pastille.** Trois catégories au choix du hôte à la création/modification de l'annonce (nouveau champ `hf-type` → `accomType`, obligatoire) : Chambre d'hôtes, Chambre d'hôtes avec table d'hôtes, Gîte (indépendant) — `ACCOM_TYPES`, affichées juste devant le nom sur la carte du fil et la fiche détail (`typeIconHtml()`). Rendu en pastille pleine (`.type-badge`, cercle 24px `--sauge-mid` + trait `--cream`) plutôt qu'en simple trait sur le fond du titre — plus net, et couleurs fixes (pas `currentColor`) qui restent lisibles aussi bien en blanc sur photo qu'en encre foncée sur fond crème. Chambre et Chambre+table partagent la même icône de base (un lit, `BED_ICON`) : la variante "avec table d'hôtes" ajoute un petit badge d'accent superposé en bas à droite (couverts, fond `--yellow`) plutôt que de tout faire tenir dans un seul pictogramme — la première version (fourchette+cuillère seules) ne se lisait que comme "table", perdant l'information "chambre d'hôtes" (retour utilisateur). Gîte reprend la silhouette du motif `MOTIFS.roof` déjà utilisé ailleurs (dégradés de secours), pour un repère visuel cohérent avec le reste de l'appli plutôt qu'une maison réinventée. Une annonce réelle existante n'a pas encore ce champ (créée avant son ajout) : elle n'affiche simplement aucune pastille tant qu'elle n'a pas été réenregistrée, plutôt que d'en deviner une. Aucune règle Firestore à changer : la règle d'update du propriétaire autorise déjà n'importe quel champ tant que `status` ne bouge pas.

**Gîte : plus de notion de "chambre à ajouter".** Un gîte est loué en bloc (logement indépendant, jamais plusieurs chambres gérées séparément) — demander de cliquer "+ Ajouter une chambre" n'avait pas de sens pour ce type (retour utilisateur). `updateUnitsFraming()`, appelée à l'ouverture du formulaire et à chaque changement de `hf-type`, adapte la section tarif/capacité en fonction : pour Gîte, une seule carte est créée automatiquement ("Capacité et tarif du gîte", ni bouton "+ Ajouter" ni bouton "×"), pour Chambre/Chambre+table le comportement multi-chambres existant reste inchangé (plusieurs cartes nommées "Chambre 1", "Chambre 2"…, ajout/retrait libres). Le modèle de données ne change pas (`units` reste un tableau, avec une seule entrée pour un gîte) — seule l'interface s'adapte.

**Recadrage photo : bug de centrage corrigé.** Les deux aperçus (Carte 4/5, Fiche 5/4) affichés pendant le recadrage manuel décalaient l'image dans le **mauvais sens** (`ox+shift` au lieu de `ox-shift`, `updatePreviews()`) : un cadrage pourtant centré dans le carré source semblait décalé de 18px sur les deux aperçus à la fois, rendant un centrage simultané visuellement impossible (retour utilisateur : "impossible d'avoir bien l'image au centre sur les deux"). Bug de prévisualisation uniquement — l'image carrée réellement exportée (calculée dans `okBtn.onclick`, indépendante de ces aperçus) et son recadrage à l'affichage (`object-fit:cover`, centré nativement par le navigateur) n'ont jamais été affectés, mais un aperçu qui ment pousse à sur-corriger ou à abandonner un cadrage qui aurait été le bon. Signe moins, testé et vérifié par le calcul (aperçu 4/5 et 5/4 tous deux effectivement centrés sur un même point de l'image source).

**Pictogrammes de type d'hébergement retirés, remplacés par un libellé texte.** Retour utilisateur : "je n'aime pas les petits logos". `typeIconHtml()`, `.type-badge`/`.type-badge-accent` et les icônes associées (`BED_ICON`/`FORK_ICON`) supprimés — plus aucun pictogramme nulle part (fil, carte sélectionnée sur la carte, fiche détail). `ACCOM_TYPES` garde uniquement ses libellés (`chambre`/`chambretable`/`gite`), affichés en texte (`.type-label`) juste avant la description sur la fiche détail (seul endroit où `l.desc` est montré) : même corps que la description (14.5px) mais `font-weight:700` au lieu de 400, pour se distinguer sans faire titre. Rien côté fil ni côté hostform (le select `hf-type` reste inchangé, toujours obligatoire).

**Barre de contact fixe supprimée de la fiche détail.** `.detail-contact-bar` (WhatsApp/SMS/Appeler, fixée en bas d'écran au-dessus de la barre d'onglets) faisait doublon avec la barre inline du panneau de demande rapide (même boutons, juste en dessous du message pré-rempli) — retirée (markup, CSS, `--tabbar-h`, et la ligne `.detail-body` padding-bottom réduite de 140px à 90px en conséquence). **Compromis assumé, tranché explicitement par l'utilisateur** : sur une annonce à plusieurs chambres, l'onglet "Vue d'ensemble" n'a pas de panneau de demande rapide inline (chaque chambre a le sien, pas l'établissement dans son ensemble) — cet onglet n'offre donc plus aucun moyen de contacter l'hôte directement ; il faut basculer sur une chambre précise pour ça. La carte hôte y reste visible (nom, avatar), juste sans les boutons d'action.

### Disponibilité réelle côté voyageur (Cloud Functions)

Le calendrier voyageur (fil, fiche détail) lisait jusqu'ici uniquement `l.avail`/`unit.avail`, toujours vide sur une annonce réelle — la démo n'a jamais été connectée aux vraies réservations, ni celles de `app/` (compte gestion), ni celles du calendrier simplifié de Séjours (compte simple annonce). C'est corrigé, mais pas en réutilisant simplement la lecture existante du calendrier hôte (`fetchHostBookings()`) : **`accounts/{uid}` et `listings/{id}/bookings` sont, par design, réservés au propriétaire connecté** (voir les règles Firestore plus bas) — un visiteur non connecté ne peut lire ni l'un ni l'autre, et il n'était pas question d'élargir la lecture de `accounts/{uid}` pour y remédier : ce document contient aussi les seuils fiscaux, les structures juridiques et les transactions bancaires, pas seulement les réservations d'une chambre.

**Architecture retenue : une projection publique, minimale, republiée côté serveur.**

- `functions/index.js` (nouveau dossier, Cloud Functions v2) : trois déclencheurs —
  - `syncPublicAvailFromAccount`, sur écriture de `accounts/{uid}` (compte gestion — `bookings` y est un **tableau sur le document**, pas une sous-collection) : retrouve les annonces Séjours de ce propriétaire ayant une chambre liée (`unit.linkedRoomId`) et republie, pour chacune, les dates de LA chambre `app/` à laquelle elle est liée.
  - `syncPublicAvailFromListingBookings`, sur écriture de `listings/{id}/bookings/{bookingId}` (compte simple annonce, sous-collection propre à Séjours) : republie les dates de la chambre concernée (`unitId`), sans notion de lien — une réservation y appartient déjà directement à une chambre.
  - `syncListingContactStats`, sur écriture de `contactLog/{uid}/entries/{entryId}` : maintient `listings/{listingId}.stats.{demandeCount,confirmedCount}` par incrément — voir « Séjours → conversion » plus bas.
  - Les deux écrivent dans `listings/{id}/publicAvail/{unitId}` **uniquement** `{ranges:[{checkIn,checkOut}], updatedAt}` — jamais de nom de client, jamais de prix, jamais aucun autre champ (`toPublicRanges()`, testé isolément : voir le nettoyage des champs). Écrit avec le SDK Admin (qui contourne les règles Firestore), ce qui permet à la règle `publicAvail` d'interdire toute écriture cliente (`allow write: if false`, voir règles plus bas) — même le propriétaire connecté ne peut pas y écrire directement, seule la fonction le peut.
- **Lecture, côté client** (`sejours/index.html`, `wireQuickReq()`) : une fois le panneau de demande rapide affiché, si la chambre concernée a un `id` réel (`l.docId`), lecture ponctuelle (pas d'écoute temps réel) de `listings/{id}/publicAvail/{unitId}` — publique, aucune connexion requise. Si le document existe, le calendrier bascule du mode démo vers un mode réel : `.cal-nodata` est retiré, la navigation passe d'une année fixe qui boucle (`DEMO_YEAR`) à une vraie année/mois qui avance dans le temps (`realCalendarGridHtml()`/`isDateOccupied()`), une date est disponible si elle n'est dans aucune plage occupée ET pas déjà passée. Si le document n'existe pas encore (jamais synchronisé), rien ne change : le calendrier reste en mode démo/« pas de données » — dégradation propre, aucune annonce n'est cassée par l'absence de données réelles.
- **Quelle chambre ?** Une annonce à plusieurs chambres (`hasTabs`) : chaque onglet a la sienne (`activeUnit`), déjà le cas pour l'ancien système `unit.avail`. Une annonce à une seule chambre (`!hasTabs`, la majorité des cas) : jusqu'ici son calendrier ne pointait vers AUCUNE chambre précise (retombait sur `l`) — `soleUnitOf(l)` comble ce trou (la chambre unique d'une annonce ne peut être que celle-là), à la fois pour le calendrier du fil (`wireFeedEvents()`) et celui de la fiche détail.

**Pourquoi une fonction, pas juste un document que l'hôte écrit lui-même en ouvrant Séjours ?** Une alternative sans Cloud Function existait (l'hôte republie en ouvrant son "Mon calendrier"), mais la fraîcheur n'aurait suivi que ses visites, pas les réservations elles-mêmes. Choix fait avec l'hôte : vraie synchro, au prix d'un vrai déploiement serveur (ci-dessous) — ce projet n'en avait aucun jusqu'ici (tout reposait sur le navigateur + les règles Firestore), c'est donc une première brique d'infrastructure à part entière, pas juste un fichier de plus.

**Déploiement — à faire une seule fois, uniquement par toi (Claude ne peut ni s'y connecter ni le faire à ta place) :**
```
cd functions && npm install
firebase login                       # une fois, ouvre le navigateur
firebase deploy --only functions     # depuis la racine du dépôt
```
`firebase.json`/`.firebaserc` (racine du dépôt) pointent déjà vers le projet `fiftin-e30c2` et le dossier `functions/` — rien d'autre à configurer côté fichiers. Nécessite le forfait Blaze (déjà requis pour Storage, voir plus haut) — si ce n'est pas déjà fait, l'assistant de déploiement le proposera. **Tant que ce déploiement n'a pas été fait, aucune fonction ne tourne : le calendrier voyageur reste simplement en mode démo/« pas de données » partout, comme avant ce chantier — rien ne casse, la fonctionnalité est juste inactive.**

**Limite connue, assumée : non vérifiable de bout en bout depuis l'environnement de développement** (pas d'accès réseau à ton vrai projet Firebase). Vérifié ici : la logique de nettoyage des champs (`toPublicRanges`, en isolation — plages propres, champs sensibles bien exclus, entrées malformées bien rejetées), la syntaxe et les imports du code des fonctions (chargés avec les vraies dépendances `firebase-admin`/`firebase-functions`), et tout le comportement du calendrier voyageur côté client contre des données `publicAvail` simulées (bascule démo→réel, plages occupées correctement bloquées, jour du départ bien libre, navigation qui avance vraiment dans le temps jusqu'en 2027, repli propre pour une chambre jamais synchronisée). Ce que je ne peux pas vérifier d'ici : que les déclencheurs se déclenchent bien en conditions réelles contre `accounts/{uid}`/`listings/{id}/bookings` une fois déployés — le premier lien réel + la première réservation seront le vrai test.

### Boutons en pilule, ligne région/département, dépôt d'annonce par adresse

**Boutons Contact/Voir plus, en pilule et plus fins.** `.btn` passe de `border-radius:16px;padding:11px 16px` à `border-radius:999px;padding:8px 16px` (forme pilule) — hauteur mesurée ~33px contre ~44px avant. Rien d'autre ne change (couleurs, icônes, comportement).

**Ligne de localisation, toujours "Région, Département".** Avant, la ligne au-dessus du titre (fil et fiche détail) affichait `l.region`, un champ libre saisi par l'hôte, format non garanti. `locationLineFor(l)` centralise désormais l'affichage : `regionName`+`, `+`deptName` si les deux sont renseignés (le cas normal pour toute annonce créée depuis la refonte du hostform ci-dessous), repli sur l'un des deux seul s'il n'y en a qu'un, et repli final sur l'ancien `l.region` pour une annonce plus ancienne qui n'a que ce champ (dégradation propre, rien ne casse). Les deux affichages (`coverHtml()` pour le fil, `openDetail()` pour la fiche détail) appellent la même fonction.

**Dépôt d'annonce : adresse d'abord, région/département/ville déduits automatiquement.** Le hostform demandait jusqu'ici de remplir séparément l'adresse complète (pour le géocodage/la distance) ET la région/le département/la ville (pour le filtre Lieu) — deux saisies redondantes, la seconde souvent bâclée ou oubliée. Le champ Adresse passe maintenant en premier dans le formulaire (juste après le nom de l'hôte), avec autocomplete : `searchAddressSuggestions(query)` interroge Nominatim (`limit=5`, mêmes paramètres que le géocodage existant) après un debounce de 400ms (dès 5 caractères saisis), affiche jusqu'à 5 suggestions cliquables (`.hf-address-suggestions`) sous le champ. Choisir une suggestion (`applySuggestion()`) remplit l'adresse ET déduit région/département depuis les champs `address.state`/`address.county`/`address.state_district` retournés par Nominatim, via `matchRegionDept()` (comparaison par sous-chaîne contre le référentiel `FR_REGIONS`) — toujours réappliqué à la sélection, mais la ville n'est complétée que si le champ est encore vide, pour ne jamais écraser une correction manuelle de l'hôte. Le champ libre "Localisation (affichée aux voyageurs)" (`hf-region`), redondant avec ce nouveau mécanisme, est retiré du formulaire ; `submitHostForm()` calcule désormais `region` lui-même (`ville, département` ou repli sur la région/l'adresse) au lieu de le lire dans le DOM. Même filet de sécurité au moment de l'envoi, pas seulement à la sélection d'une suggestion : si l'hôte n'a pas cliqué de suggestion et a laissé région/département/ville vides, `geocodeAddress()` (toujours appelé pour la distance, `limit=1`) renvoie maintenant aussi `address`, et le même `matchRegionDept()` comble les champs encore vides juste avant l'envoi — sans jamais écraser une valeur déjà renseignée, manuellement ou via une suggestion.

### Libellé de type, retrait du texte "de l'hôte", vignettes carte, bouton Mail, bug filtres/carte, marges

**Type d'hébergement affiché dès le début, plus dans la description.** `taglineHtml(l)` (nouveau, `sejours/index.html` — remplace l'ancien `typeLabelHtml()`) centralise le rendu et est appelée à un seul et même endroit conceptuel des deux côtés : juste avant l'accroche (claim) — sur la carte du fil (`coverHtml()`, entre le nom et l'accroche, en `--cream` sur la photo) et sur la fiche détail (`openDetail()`, entre le titre et l'accroche, en `--ink` sur fond crème). Retiré de son ancien emplacement, juste avant la description — plus assez visible là, retour utilisateur. `ACCOM_TYPES` simplifié à deux catégories, "Chambre d'hôtes" et "Gîte" (retour utilisateur) : "Chambre d'hôtes avec table d'hôtes" retirée, et "Gîte (hébergement indépendant)" redevient simplement "Gîte". Une annonce déjà enregistrée avec l'ancienne valeur `accomType:"chambretable"` n'affiche plus aucun libellé (même dégradation propre qu'un type jamais renseigné) — à réenregistrer avec "Chambre d'hôtes" ou "Gîte" pour qu'un libellé réapparaisse.

**Type et accroche sur une seule ligne, séparés par "•".** `taglineHtml(l)` ne rend plus deux paragraphes empilés (`.type-label` puis `.tagline.claim`) mais un seul `<p class="tagline claim">`, avec le type en `<span class="type-label">` suivi d'un `<span class="type-sep">•</span>` puis l'accroche — retour utilisateur, ça prenait une ligne entière pour peu de texte. La distinction typographique entre les deux reste entière malgré le même conteneur : `.type-label` déclare explicitement `font-family:'Jost',sans-serif; font-style:normal; font-weight:700` — une déclaration directe sur l'élément l'emporte toujours sur l'héritage du parent (`.claim`, serif Fraunces italique), quelle que soit la spécificité de la règle qui a posé le style du parent. Aucun séparateur si le type n'est pas renseigné (repli sur l'accroche seule, comme avant) ni si l'accroche est vide.

**"Vous contacte directement" retiré partout.** Ce texte (`host.response`, toujours la même valeur fixe pour toute annonce réelle — jamais une vraie donnée comme un temps de réponse) n'apportait aucune information utile au voyageur, qui sait déjà qu'il contacte l'hôte en direct puisque c'est le principe même de Séjours — retour utilisateur. Retiré de la fiche détail aux deux endroits où il apparaissait : la 3ᵉ case de `.meta-row` (qui n'en garde plus que 2 : prix, distance) et le `host-card` (qui n'affiche plus que le nom de l'hôte). Le champ `response` lui-même est supprimé du modèle (`normalizeHostListing()`) plutôt que laissé mort.

**Vignettes de la carte : vraie photo quand il y en a une.** `.map-list-item .sw` (liste sous la carte) n'affichait jusqu'ici qu'un dégradé de secours, même pour une annonce avec de vraies photos. Nouveau helper `listingThumbUrl(l)` (même repli que `coverHtml()` : galerie de l'établissement, sinon celle de sa première chambre) : une photo trouvée → `<img class="sw">` couvrante (`object-fit:cover`) ; aucune → le dégradé `<div class="sw">` d'avant, inchangé.

**Bug corrigé : le volet de filtres passait sous la carte.** Sur l'onglet Carte, ouvrir un filtre (Lieu, Distance…) affichait bien le volet, mais celui-ci restait invisible/inutilisable derrière la carte (Leaflet) et son bouton "Dessiner une zone" (`z-index:1000` explicite) — alors que la hiérarchie de calques documentée plus haut (hero > sheet/modal `150` > `.detail` `200` > `nav.tabbar` `50` > `#feed`) voudrait qu'un sheet passe toujours au-dessus du contenu de `#feed`. En cause : `.map-canvas` avait `position:relative` mais pas de `z-index` propre, donc les z-index élevés de ses enfants (jusqu'à 1000, et les tuiles/marqueurs Leaflet jusqu'à ~700) se comparaient directement à ceux du reste de la page au lieu d'être confinés à l'intérieur. Correctif : `.map-canvas{position:relative; z-index:0; ...}` — un `z-index` explicite ouvre un contexte d'empilement propre à cet élément, qui contient tous les z-index internes quelle que soit leur valeur ; `.map-canvas` dans son ensemble ne vaut plus que 0 pour le reste de la page, et ne peut donc plus jamais repasser au-dessus d'un sheet.

**Prix des punaises de la carte : le "€" ajouté.** Un nombre seul (`<span>150</span>`) ne se lisait pas forcément comme un prix. `<span>150€</span>` désormais, police légèrement réduite (11px → 9.5px, avec `letter-spacing:-.02em`) pour que "150€" tienne dans la punaise (30px) comme "150" avant.

**Marges identiques sur toutes les vues, très légèrement agrandies.** `.map-view`, `.profile-view`, `.admin-queue` et `.host-view` (Carte, Profil, validation admin, Espace hôtes) ajoutaient chacune leur propre padding latéral (18-20px) PAR-DESSUS celui de `#feed` (11px, déjà appliqué puisque ces vues sont injectées à l'intérieur) — leurs vignettes/contenus étaient donc visiblement plus étroits que sur Explorer/Envies, qui n'utilisent que `#feed` directement. Les quatre vues perdent leur padding latéral propre (`padding:Xpx 0 Ypx`, hérite désormais entièrement de `#feed`) ; `#feed` passe de `11px` à `14px` de marge latérale (très léger ajustement demandé pour Explorer, qui se propage donc à l'identique partout).

**Bouton Mail, carrés façon icône d'appli.** 4ᵉ bouton de contact (Mail, WhatsApp, SMS, Appeler), Mail en premier, même principe de message pré-rempli que les autres (`mailto:` avec sujet et corps encodés). Nécessite un e-mail de contact : nouveau champ obligatoire "E-mail de contact" (`hf-email`) dans le hostform, juste après le téléphone — volontairement distinct de l'e-mail du compte (Firebase Auth), pour ne jamais exposer publiquement l'e-mail de connexion d'un compte par ailleurs utilisé pour la gestion financière (`app/`). Stocké dans `email` sur le document `listings/{id}`, lu comme `host.email`. Aucune valeur sur une annonce plus ancienne créée avant ce champ → pas de bouton Mail plutôt qu'un `mailto:` vide (dégradation propre) ; **point d'attention réel** : `email` est désormais obligatoire aussi bien à la création qu'à la MODIFICATION d'une annonce (même règle que le téléphone) — la prochaine modification d'une annonce plus ancienne sans e-mail de contact sera donc bloquée tant qu'il n'est pas renseigné, comme n'importe quel autre champ obligatoire manquant. Design des 4 boutons repris de `.tab-icon` (barre d'onglets du bas, voir plus haut) plutôt qu'inventé : un carré à bords arrondis (`.send-icon`, 16px de rayon) autour du pictogramme seul, coloré par canal (Mail = `--sauge`, WhatsApp = `--sauge-mid`, SMS = `--lavender`, Appeler = `--yellow`), le libellé en dehors, non coloré — avant, le libellé était à l'intérieur du bouton coloré (rectangle, pas carré).

**Boutons Contact/Voir plus : pilule abandonnée, retour à des encarts à bords arrondis.** `.btn` repasse de `border-radius:999px` à `16px` (retour utilisateur) — seul le rayon change, padding/couleurs/comportement inchangés. Partagé avec les boutons Mail/WhatsApp/SMS/Appeler (`.btn.send-btn`), mais sans effet visible dessus : leur fond coloré est porté par `.send-icon` (span interne), pas par le `.btn` lui-même.

**Dégradé du bas de la carte, très légèrement assombri.** `.cover .scrim` (le voile qui assure la lisibilité du texte blanc posé sur la photo) passe de `rgba(20,26,20,.86)` à `.93` en bas de carte — retour utilisateur, la lisibilité restait perfectible sur certaines photos claires. Le point de départ du dégradé (38%, transparent) ne change pas.

**Localisation de la fiche détail : Département, Ville plutôt que Région, Département.** Nouvelle fonction `detailLocationLineFor(l)`, même repli en cascade que `locationLineFor(l)` (déptName+ville, puis déptName seul, puis ville seule, puis repli sur l'ancien champ libre `l.region`) mais avec `deptName`/`city` plutôt que `regionName`/`deptName` — demandé spécifiquement pour la fiche détail (`openDetail()`), plus parlant une fois qu'on est déjà sur l'annonce. La carte du fil (`coverHtml()`) garde `locationLineFor()` inchangée (Région, Département) : les deux affichages n'utilisent donc plus la même fonction, contrairement à avant.

**Homogénéisation des rayons d'angle.** Retour utilisateur : la dizaine de valeurs de `border-radius` utilisées dans le fichier (8/10/12/14/18/20/24px, en plus des 16px et 26px déjà cohérents à certains endroits) n'obéissait à aucune règle repérable — deux éléments au rôle visuel identique (deux familles de chips, deux types de carte, deux calendriers) pouvaient avoir un rayon différent sans raison. Ramené à une échelle à 4 paliers, appliqués par rôle plutôt que par taille brute :
- **8px** — cellules utilitaires : `.cal-cell`/`.cal-mini-day` (cases de calendrier, les deux calendriers de l'appli confondus), `.crop-preview-box` (aperçus de recadrage).
- **12px** — vignettes et petits éléments compacts : miniatures (`.hf-photo-thumb`, `.unit-thumb`, `.map-list-item .sw`, `.admin-thumb`), petites pastilles/tags (`.chip .n`, `.pill-badge`, `.avail-chip`), carrés d'icône (`.tab-icon`, `.switch-icon`), champs compacts (`.qr-field input`, `.stepper`, `.msg-preview`, `.host-listing-select`).
- **16px** — le palier standard, très largement majoritaire : boutons (`.btn`, `.btn-apply`, `.btn-photo-add`), champs de formulaire (`.text-input`, `.host-link-row select`), toutes les puces/chips filtrantes ou de sélection (`.chip`, `.amenity-chip`, `.region-chip`, `.radio-row`, `.google-link`, `.admin-reject`, `.host-status-badge`, `.cal-today-btn`, `.cal-add-pill`, `.map-zone-btn`), et la quasi-totalité des cartes/conteneurs (`.detail-group`, `.detail-card`, `.hf-unit-card`, `.unit-card`, `.host-card`, `.stat-tile`, `.switch-tile`, `.admin-card`, `.formula-card`, `.map-list-item`, `.map-zone-controls`, `.cal`, `.cal-card`, `.send-icon`, `.crop-viewport`, `.hf-address-suggestions`, le `qr-panel` de la fiche détail). Le coin bas de `.detail-group` (arrondi seulement quand il y a des onglets de chambre) suit le même changement pour rester un seul rectangle cohérent.
- **26px** — grands conteneurs de premier niveau : `.card` (carte du fil), `.sheet` (coins hauts), `.map-canvas` (remonté de 24px pour s'aligner).

Volontairement laissés en dehors de cette passe : les cercles (`border-radius:50%` — avatars, boutons-icônes ronds, points de pagination), `#siteGate` et `.hero-menu-link` (écran d'accueil/mot de passe, où le style pleinement arrondi — `999px` — fait partie d'un langage visuel volontairement différent de l'appli elle-même), et `.detail-tab` (forme à coins arrondis seulement en haut, façon onglet de navigateur, déjà un cas particulier documenté).

### Envies → Demandes : l'historique personnel des contacts du voyageur

**Ce que c'est, et ce que ça n'est PAS.** Demande initiale : un onglet "Mes demandes" listant, pour chaque annonce, qui a contacté l'hôte et quand. Repensé en cours de route une fois le vrai besoin clarifié : ce n'est PAS un tableau de bord pour l'hôte (voir plus bas pourquoi ça aurait été une mauvaise idée), c'est un **historique personnel pour le voyageur** — puisque le contact réel se fait par SMS/WhatsApp/appel/mail, en dehors du site, le voyageur n'a ensuite aucun moyen de retrouver "quand ai-je contacté quelle annonce, et par quel moyen ?". Nouveau sous-onglet **Demandes**, à côté de **Favoris** dans l'onglet du bas Envies (bandeau à 2 segments, `.likes-toggle`, en tête de `#feed` — pas un 6ᵉ onglet dans la barre du bas : Favoris et Demandes sont les deux seules listes propres au compte du voyageur, contrairement au fil qui montre les annonces de tout le monde, donc les regrouper au même endroit a du sens).

**Limite technique réelle, assumée et documentée dans le code.** Il est impossible de savoir si un SMS/appel/mail a réellement abouti : les liens `sms:`/`tel:`/`mailto:` font sortir le navigateur vers l'appli native (Messages/Téléphone/Mail), et aucune API web ne renvoie ensuite de confirmation — sur aucun navigateur, c'est une limite du système. Ce qui EST mesurable de façon fiable, c'est l'intention : le moment où le voyageur a *appuyé* sur le bouton, juste avant la bascule vers l'appli native. C'est cette intention qui est enregistrée, jamais présentée comme une confirmation d'envoi.

**Pourquoi pas un inbox côté hôte (l'idée de départ).** Pour qu'un hôte voie "qui m'a contacté", il aurait fallu que **n'importe quel visiteur, même non connecté**, puisse écrire dans Firestore au clic — la plupart des voyageurs ne se connectent jamais juste pour contacter un hôte. Une écriture Firestore ouverte à tout le monde est une porte au spam/abus (de fausses demandes, un coût d'usage qui grimpe), sans solution complète possible sans App Check (absent du projet, comme déjà noté pour les favoris). Trancher entre couverture complète (risque de spam) et compte obligatoire (couverture partielle) était un vrai choix à faire — fait explicitement avec l'utilisateur avant de coder : compte obligatoire. La version "historique perso du voyageur" retombe sur cette même décision mais pour une bonne raison structurelle cette fois : cet historique n'a de sens que rattaché à SON compte de toute façon (sinon, aucun moyen de le retrouver plus tard), donc plus besoin d'écriture publique du tout — chaque voyageur n'écrit que dans sa propre sous-collection, comme pour les favoris. Beaucoup plus sûr, sans compromis de couverture par rapport à l'inbox côté hôte (qui, de toute façon, aurait raté la majorité des contacts anonymes).

**Modèle de données.** Nouvelle sous-collection `contactLog/{uid}/entries/{entryId}` (à la racine, sans rapport avec `listings/{listingId}` — ce n'est pas une donnée sur l'annonce ni sur l'hôte), un document par clic sur un bouton d'envoi : `{listingId, listingName, channel: "mail"|"wa"|"sms"|"call", checkIn, checkOut, createdAt}` (`checkIn`/`checkOut` : voir plus bas, ajoutés après coup pour grouper l'affichage par séjour visé). `logContact(l, channel, unitName, checkIn, checkOut)` (nouveau, appelé depuis `wireQuickReq()` sur le clic réel des 4 boutons d'envoi, pas sur `update()` qui tourne en continu pendant la saisie) — écrit UNIQUEMENT si connecté ; sans compte, rien ne se passe, silencieusement (pas de connexion forcée juste pour cliquer un bouton de contact, ce serait de la friction sur le geste principal du site). `listingName` est capturé au moment du clic (pas juste un id) pour que l'historique reste lisible même si l'annonce est renommée ou supprimée depuis. Règle Firestore : lecture/écriture strictement réservées à son propre `uid`, champs bornés à la création (canal parmi une liste fixe, `createdAt` vérifié comme un vrai timestamp serveur — jamais une valeur fournie par le client). **Nécessite la règle Firestore étendue ci-dessous (`match /contactLog/{uid}/entries/{entryId}`) — sans elle l'écriture échoue silencieusement** (best-effort, comme `writeLikeState()` : un échec réseau ne bloque jamais l'appel/SMS/mail lui-même, déjà en cours indépendamment de cette écriture).

**Affichage.** `renderContactLog()` (lecture triée par date décroissante, limitée à 100 entrées) rend chaque ligne avec `contactLogRowHtml()` — réutilise `.map-list`/`.map-list-item` (même besoin visuel que la liste sous la carte : icône + nom + sous-texte, pas de raison d'inventer un style différent), avec un nouveau `.log-icon` par canal repris des couleurs de `.send-icon` (même logique de reconnaissance immédiate "c'est le même bouton qui a déclenché ça"). Une ligne est cliquable (ouvre la fiche détail) seulement si l'annonce visée est encore chargée dans `LISTINGS` — une annonce supprimée depuis reste affichée dans l'historique (avec son nom capturé au clic) mais n'ouvre plus rien, dégradation propre plutôt qu'un lien mort.

**Correctif WhatsApp : normalisation du numéro (`waPhoneDigits()`).** Bug préexistant, sans rapport avec Demandes, repéré à cette occasion : le lien `wa.me/<numéro>` exige des chiffres purs en format international (aucun `+`, espace ou ponctuation), contrairement à `tel:`/`sms:` qui tolèrent la saisie humaine telle quelle car c'est l'appli native qui la relit. Le code construisait ce lien avec un simple `.replace("+","")`, donc tout numéro saisi au format français local (`06 12 34 56 78`, avec ou sans points/espaces) produisait un lien `wa.me` invalide — WhatsApp ne trouvait personne à l'autre bout. Nouvelle fonction `waPhoneDigits(phone)` (juste après `buildMessage()`), utilisée uniquement pour le lien WhatsApp (`tel:`/`sms:` inchangés, ils n'en ont pas besoin) : retire tout sauf chiffres et `+`, convertit un `0` initial en `33`, et corrige le cas `+33 (0)6...` (le zéro entre parenthèses, convention française courante, donnerait sinon un `330...` invalide — un vrai numéro français ne peut jamais avoir de second `0` juste après le `33`). Testé sur 6 formats réels (`+33 6 12 34 56 78`, `+33612345678`, `06 12 34 56 78`, `0612345678`, `+33 (0)6 12 34 56 78`, `06.12.34.56.78`) → tous produisent `https://wa.me/33612345678`. Aucune action requise côté hôte : le champ téléphone reste en saisie libre, la normalisation est automatique.

**Demandes : confirmer un séjour ou déclencher une annonce sans suite.** Retour utilisateur : chaque ligne de Demandes doit permettre de dire ce qu'il est advenu du contact — deux boutons carrés à droite (`.log-actions`). Coché (`.log-action.confirm`, vert sauge) : ouvre `openConfirmSheet("Ce séjour a-t-il bien eu lieu ?", "Oui, séjour confirmé", …)`. Sur "Oui", `confirmContactLogEntry()` ajoute `status:"confirmed"` et `confirmedAt` (timestamp serveur) au document — jamais l'inverse, une seule transition possible (voir la règle Firestore ci-dessous), après quoi les deux boutons disparaissent (rien de plus à décider sur cette ligne) et la ligne se résorbe dans le compteur **Séjours** du profil (`loadSejoursCount()`, un `where("status","==","confirmed")` sur sa propre sous-collection — un compte, pas une liste, recalculé à chaque ouverture du profil plutôt que stocké quelque part, pas la peine de dupliquer une donnée aussi bon marché à relire). Croix (`.log-action.decline`) : `openConfirmSheet("Cette demande n'a pas donné suite ?", "Oui, supprimer", …)`, sur "Oui" `declineContactLogEntry()` supprime purement et simplement le document (déjà permis par la règle `delete` existante, aucun changement de règle nécessaire pour ce bouton-là). Les deux boutons appellent `e.stopPropagation()` : sans ça, leur clic remonterait jusqu'à `.log-body` et déclencherait aussi la grande vignette (voir plus bas).

**`openConfirmSheet()` plutôt que `window.confirm()` natif.** Première version de ces deux actions : `confirm()` natif du navigateur. Problème réel, repéré après coup : ses boutons sont TOUJOURS "OK"/"Annuler" (aucune API JS pour les relabelliser), alors que le texte posait une question en "Oui/Non" — décalage jamais voulu (la demande initiale disait bien "Oui/Non"). Nouvelle fonction générique `openConfirmSheet(title, yesLabel, onYes)` (juste après `closeSheet()`) : réutilise le composant `.sheet`/`.sheet-backdrop` déjà dans le fichier (mêmes styles, même fermeture au clic sur le fond ou sur ×), avec deux vrais boutons (`.btn-apply` pour "Oui, …", un `.link-btn` discret pour "Non") — volontairement à part du dispatch par `kind` d'`openSheet()` (pensé pour des volets filtres/formulaires, pas pour un message + un callback arbitraires).

**Classer les demandes : confirmées à part, en cours groupées par séjour visé.** Retour utilisateur : au-delà de 3-4 demandes, la liste plate devient illisible. `groupedContactLogHtml()` (remplace le rendu à plat de `renderContactLog()`) sépare d'abord les demandes confirmées (statut réglé, plus rien à faire) des demandes en cours ; les confirmées restent une simple liste en bas, les en cours sont sous-groupées par **dates de séjour demandées** (`stayPeriodLabel()`, ex. "Séjour du 10 avr. au 17 avr. 2026") — pas par date de clic : contacter 3 hôtes le même jour ne veut pas dire que c'est pour le même voyage, alors que viser les mêmes dates chez 3 hôtes différents, si (retenu après en avoir discuté). Les groupes de dates suivent l'ordre naturel des documents (déjà triés par `createdAt` décroissant), donc le séjour le plus récemment "travaillé" remonte en premier, sans tri supplémentaire à calculer. Nécessite de connaître les dates visées au moment du clic — voir `checkIn`/`checkOut` ci-dessous, absents du modèle de données jusqu'ici.

**Bug latent découvert au passage : `wireQuickReq()` s'empilait à chaque réouverture du panneau.** `wireFeedEvents()` rappelle `wireQuickReq()` à chaque clic sur le bouton "Contacter" (`[data-quickreq]`, pas seulement au premier rendu de la carte), sans jamais retirer les écouteurs posés la fois précédente — jusqu'ici sans conséquence visible (`update()` ne fait que réécrire les mêmes `href`), mais `logContact()` a rendu ce défaut réel : rouvrir 3 fois le même panneau puis cliquer WhatsApp écrivait 3 fois la même demande dans `contactLog` (repéré en testant le classement par période, deux entrées identiques au timestamp près apparaissaient). Corrigé avec une garde `$prev.dataset.wired` en tête de `wireQuickReq()` : les `addEventListener` (boutons d'envoi, dates, stepper, calendrier) ne sont posés qu'une fois par panneau ; `update()` continue de tourner à chaque appel (gratuit). Le flag vit sur le nœud DOM du panneau lui-même, donc se réinitialise naturellement si ce panneau est re-rendu ailleurs (`selectMapListing()`/`selectDemandeListing()`).

**`checkIn`/`checkOut` ajoutés à `contactLog`, capturés au clic.** `logContact()` prend deux nouveaux paramètres, remplis avec `$in.value`/`$out.value` du panneau de demande rapide au moment précis du clic sur un bouton d'envoi (`wireQuickReq()`) — toujours renseignés (préremplis par défaut dans `quickReqHtml()`, jamais vides), donc champs obligatoires dans la règle Firestore de création (voir plus bas), pas de branche optionnelle à gérer. Aucun rapport avec une vraie réservation confirmée (`bookings`) : c'est juste ce que le voyageur visait au moment du contact, qui peut très bien ne jamais se concrétiser — sert uniquement à grouper l'affichage (ci-dessus), jamais lu ni écrit ailleurs.

**Aperçu de chaque demande : même principe que la liste de la carte, plus une ligne.** `contactLogRowHtml()` réutilisait `.log-icon` (icône colorée par canal) ; remplacé par la vignette photo de l'annonce (`listingThumbUrl(l)`, avec repli en dégradé si l'annonce n'est plus chargée) — retour utilisateur explicite : "utilise exactement ce principe d'aperçu" que `.map-list-item` de l'onglet Carte (photo + nom + région/prix). Seul ajout : une 3ᵉ ligne (moyen de contact + date/heure du clic, `fmtContactDate()` étendu pour inclure l'heure). `.map-list-item span` passe en `display:block` pour que ces deux sous-lignes s'empilent au lieu de se suivre côte à côte (sans effet sur la carte, qui n'a qu'un seul span par item). `CONTACT_CHANNEL_META` perd ses SVG par canal, devenus inutiles ici (ne restait que `.label`) — les pictogrammes originaux vivent toujours dans le panneau de demande rapide (`.send-btn`).

**Clic sur une demande : grande vignette d'abord, comme sur la carte.** Avant : cliquer une ligne ouvrait directement la fiche détail complète. Retour utilisateur : reprendre le même mécanisme que cliquer un item de `.map-list` dans l'onglet Carte (`selectMapListing()`) — la ligne réduite ouvre une grande vignette (le composant `.card` complet, avec son propre "Voir plus" qui mène ensuite à la fiche détail). Nouvelle paire `selectDemandeListing()`/`renderDemandeSelectedCard()`, structurellement identique à `selectMapListing()`/`renderMapSelectedCard()` mais délibérément dupliquée plutôt que factorisée : deux variables d'état (`mapSelectedId`/`demandeSelectedId`) sans rapport l'une avec l'autre, propres à deux onglets différents — les fusionner aurait ajouté un paramètre de contexte pour un gain nul. Conteneur `#demandes-selected` (même classe `.map-selected` que la carte), inséré juste au-dessus de la liste groupée, réinitialisé (`demandeSelectedId = null`) à chaque nouveau rendu de `renderContactLog()` pour ne pas survivre à une confirmation/suppression.

**Séjours → conversion : ce que l'hôte peut savoir, ce qu'il ne peut pas.** Demande initiale : afficher, dans le détail d'une annonce, le pourcentage de demandes qui ont donné suite à un vrai séjour. Contrainte réelle rencontrée : `contactLog/{uid}/entries` est **strictement privé à son auteur** (voir plus haut, "pas même un compte isAdmin()") — c'est le choix de sécurité qui rend cette collection sûre sans écriture publique, mais il interdit du même coup à QUICONQUE côté client, y compris l'hôte lui-même, de lire les demandes des autres voyageurs pour calculer ce taux. Seule une Cloud Function (SDK Admin, qui contourne les règles) peut agréger across tous les voyageurs — même raisonnement, déjà appliqué dans ce projet, que la projection publique de disponibilité (`publicAvail`, voir plus bas). Nouveau déclencheur `syncListingContactStats` (`functions/index.js`), sur écriture de `contactLog/{uid}/entries/{entryId}` : incrémente/décrémente `listings/{listingId}.stats.demandeCount` et `.confirmedCount` (`FieldValue.increment`, jamais un recomptage complet — évite une requête `collectionGroup` sur `entries`, qui aurait exigé un index composite en plus à créer côté Firebase Console). **Nécessite un nouveau déploiement Cloud Functions que toi seul peux faire** (`firebase deploy --only functions`, voir plus bas) — sans lui, `stats` ne bougera jamais et le pourcentage n'apparaîtra pas.

Affichage : `conversionLabelFor(l)` (juste après `logContact()`), un 3ᵉ `.meta-item` dans le bandeau prix/distance de la fiche détail (`openDetail()`, vue d'ensemble uniquement — le taux est au niveau de l'annonce, pas d'une chambre) — **visible uniquement quand `authState.uid === l.ownerUid`**, décision volontaire : c'est une donnée business pour l'hôte, pas un argument à exposer aux voyageurs (un pourcentage bas, souvent sur un échantillon minuscule, découragerait des réservations légitimes sans raison). `null` tant qu'aucune demande n'a jamais été enregistrée (pas de "0%" trompeur — 0% de conversion et "personne n'a encore contacté" sont deux informations différentes). Champ `stats` ajouté à `normalizeHostListing()` avec `ownerUid` (tous deux absents jusqu'ici), et verrouillé côté règles Firestore : un propriétaire ne peut pas fabriquer lui-même un taux flatteur en modifiant son annonce (voir la règle `listings/{listingId}` étendue ci-dessous — `.update(payload)` depuis le formulaire hôte ne touche jamais `stats`, donc cette égalité reste vraie pour toute vraie modification, et ne bloque que la triche).

**Carte et cartes de liste — retours utilisateur.** `.map-canvas` (onglet Carte) passe de `aspect-ratio:3/4` à `1/1` : la carte prenait trop de hauteur sur mobile, empêchait de scroller jusqu'à la liste en dessous. `.map-list-item` (liste sous la carte, ET Demandes qui réutilise le même style) passe de `background:var(--cream-deep)` à `#fff`, et sa vignette `.sw` de 44px à 56px puis 68px (deux retours utilisateur successifs, "encore un peu plus grand, moins de blanc autour") — le padding de la carte (`10px 12px`) et le rayon de la vignette (12px, palier "miniatures" documenté plus bas) n'ont pas bougé, seule sa taille augmente.

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
          && request.resource.data.status == resource.data.status
          // stats (compteur de conversion demandes -> séjours, voir plus
          // bas et functions/index.js) : écrit UNIQUEMENT par la Cloud
          // Function syncListingContactStats (SDK Admin, hors règles) —
          // un propriétaire modifiant sa propre annonce via le formulaire
          // hôte ne touche jamais ce champ (.update(payload) préserve les
          // champs non listés dans payload), donc cette égalité reste vraie
          // pour toute vraie modification et bloque seulement une
          // tentative de fabriquer soi-même un taux de conversion flatteur.
          && request.resource.data.get('stats', null) == resource.data.get('stats', null))
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

      // Projection PUBLIQUE des disponibilités (calendrier voyageur, voir
      // README plus bas) : uniquement checkIn/checkOut, republiée par les
      // Cloud Functions (functions/index.js) à partir de accounts/{uid} ou
      // de bookings/ ci-dessus — jamais de nom de client ni de donnée
      // financière. `allow write: if false` est volontaire : le SDK Admin
      // utilisé par les Cloud Functions contourne les règles Firestore, donc
      // AUCUN client, pas même le propriétaire connecté, ne doit pouvoir
      // écrire ici directement (ça permettrait de publier de fausses
      // disponibilités). Seule la fonction, qui lit les vraies données
      // privées côté serveur, a le droit d'y toucher.
      match /publicAvail/{unitId} {
        allow read: if true;
        allow write: if false;
      }
    }

    // Historique personnel du voyageur (Envies → Demandes, voir
    // logContact() dans sejours/index.html) : un document par contact
    // initié (Mail/WhatsApp/SMS/Appeler cliqué), pour qu'il puisse
    // retrouver plus tard quand et par quel moyen il a contacté un hôte —
    // jamais une confirmation que le SMS/appel/mail a réellement abouti
    // (impossible à savoir, voir le commentaire de logContact()). Aucun
    // rapport avec listings/{listingId} ci-dessus : pas une donnée sur
    // l'annonce ni sur l'hôte, uniquement l'historique du voyageur lui-même,
    // donc une collection à part, strictement privée à son auteur — jamais
    // lisible ni modifiable par personne d'autre, pas même un compte
    // isAdmin() (ce n'est pas une donnée à modérer). Champs bornés
    // strictement à la création : un canal parmi une liste fixe, et une
    // date serveur — jamais fournie par le client (request.time, jamais
    // request.resource.data.createdAt tel quel, qui pourrait être falsifié).
    match /contactLog/{uid}/entries/{entryId} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.channel in ['mail', 'wa', 'sms', 'call']
        && request.resource.data.listingId is string
        && request.resource.data.listingName is string
        && request.resource.data.checkIn is string
        && request.resource.data.checkOut is string
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly(['listingId', 'listingName', 'channel', 'checkIn', 'checkOut', 'createdAt']);
      // Seule mise à jour permise : confirmer un séjour (Envies -> Demandes,
      // bouton "validé", confirmContactLogEntry()) — une transition à SENS
      // UNIQUE, pending (pas de champ status) -> confirmed, jamais l'inverse
      // et jamais une seconde fois (resource.data.get('status', null) doit
      // être absent avant l'écriture : une fois confirmée, la règle refuse
      // toute nouvelle mise à jour, cohérent avec l'UI qui retire les
      // boutons d'action une fois confirmé). confirmedAt vérifié comme un
      // vrai timestamp serveur, même principe que createdAt à la création.
      allow update: if request.auth != null && request.auth.uid == uid
        && resource.data.get('status', null) == null
        && request.resource.data.status == 'confirmed'
        && request.resource.data.confirmedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'confirmedAt']);
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
