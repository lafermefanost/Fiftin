# Fiftin

Outil de planning pour locations courte durée / chambres d'hôtes.

- `index.html` — page de présentation commerciale (fiftin.fr).
- `app/index.html` — l'outil complet (une seule page, pas de build) : fiftin.fr/app/.
- `sejours/index.html` — Fiftin Séjours, l'annuaire de réservation directe pour les voyageurs (nouveau projet, prototype) : fiftin.fr/sejours/.
- Déployé via GitHub Pages sur **fiftin.fr** (voir le fichier `CNAME`).
- Copie initiale de l'outil basée sur `lafermefanost/ferme-fanost/planning.html`, avec la marque renommée « Fifteen » → « Fiftin ».

## Fiftin Séjours (`sejours/`) — annuaire de réservation directe

Projet frère de l'outil de planning, même marque mais codebase et périmètre séparés (voir `CLAUDE.md`) : un annuaire mobile-first pour que les voyageurs trouvent un hébergement et contactent l'hôte directement (WhatsApp, SMS, appel), sans commission ni intermédiaire — dans l'esprit de Cybevasion, en mieux.

- Prototype statique : les annonces sont dans `sejours/listings.json` (pas dans le HTML, voir plus bas), pas de vraies photos partout (dégradés stylisés en attendant).
- À terme : lien avec le calendrier de réservations de l'outil de planning (`app/`), pour que la disponibilité affichée ici soit réelle — pas encore construit.

### Dépôt d'annonce par un hôte (onglet Profil → Espace hôtes)

Un compte connecté (même Firebase Auth que `app/` — voir « Comptes et données » ci-dessous, même projet donc même compte des deux côtés) peut se connecter/s'inscrire directement dans Séjours et déposer une annonce, photos comprises (upload direct vers Firebase Storage). Écrit dans une nouvelle collection Firestore `listings/{id}` avec `status:"pending"` à la création — **jamais publiée automatiquement**.

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
          && request.resource.data.status == resource.data.status);
      allow delete: if isAdmin()
        || (request.auth != null && resource.data.ownerUid == request.auth.uid);

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

Depuis l'onglet Profil, un hôte connecté qui clique sur « Espace hôtes » bascule toute l'application dans un mode hôte : la barre d'onglets affiche **Mes annonces** / **Mon calendrier** / **Espace voyageur** (retour), le bandeau de filtres disparaît. « Mon calendrier » reprend la présentation année (12 mini-mois, numéros de semaine, cases occupées colorées) de la vue Année de `app/`, simplifiée à une seule annonce à la fois.

Deux catégories d'hôtes, déterminées par l'existence du document `accounts/{uid}` — pas un choix par annonce, et pas de palier gratuit à distinguer côté `app/` (`settings.plan` vaut `'essentiel'` ou `'pro'`, les deux sont payants ; l'existence même du document suffit donc à qualifier un « compte gestion ») :

- **Compte simple annonce** (pas de document `accounts/{uid}`) : Séjours est le seul outil de planning de cet hôte. Lecture/écriture complète, réservations stockées dans `listings/{listingId}/bookings/{bookingId}` (juste `name`, `checkIn`, `checkOut`) — taper une case libre ouvre nom du client + dates, taper une case occupée propose de la supprimer. C'est le mode « je n'ai que des hébergements, je veux un outil très simple ».
- **Compte gestion** (`accounts/{uid}` existe) : Séjours passe en **lecture seule**. Un sélecteur « Afficher les réservations de » (une chambre parmi `accounts/{uid}.settings.rooms`) permet d'afficher, à titre indicatif, les dates déjà occupées côté `app/` — pour éviter un double-emploi visuel — mais aucune case n'est éditable ni supprimable depuis Séjours, et le bouton d'ajout est remplacé par un lien vers `app/`. **Aucune écriture vers `accounts/{uid}` n'existe nulle part dans `sejours/index.html`** : ni `.set()`, ni `.update()`, ni `arrayUnion`/`arrayRemove` — c'est une garantie structurelle (le code n'a tout simplement pas ce chemin), pas une précaution au cas par cas, précisément parce qu'`accounts/{uid}` porte les données réelles de planning d'un client payant et que `app/` lui-même fait un `.set()` plein document à chaque synchro (`pushToFirebase()`) : n'importe quelle écriture concurrente y créerait un risque de course inutile.

## À faire avant un vrai passage en production

- Paiement en ligne (Stripe) — essai gratuit 15 jours, puis abonnement réel.
- Étendre l'export/import JSON à l'ensemble des réglages (aujourd'hui seuls réservations/clients/événements sont couverts).
- Parcours de démarrage pour un nouveau compte (aujourd'hui on atterrit sur une grille vide avec des chambres génériques).
- Vérification d'e-mail à l'inscription (pas encore demandée).
- « Se connecter avec Google » (pas encore ajouté, volontairement, pour garder le premier lancement simple).
- Mentions légales, CGU/CGV, politique de confidentialité (page de présentation commerciale).
