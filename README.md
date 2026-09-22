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

#### Valider (publier) une annonce déposée — pas encore d'interface dédiée, donc à la main

1. Aller sur **[console.firebase.google.com/project/fiftin-e30c2/firestore/data](https://console.firebase.google.com/project/fiftin-e30c2/firestore/data)** (se connecter avec le compte Google qui gère le projet Fiftin si demandé).
2. Dans la liste des collections à gauche, cliquer sur **`listings`**.
3. Chaque document correspond à une annonce déposée. Ouvrir un document pour voir ses champs : `name`, `region`, `price`, `claim`, `desc`, `phone`, `amen`, `gallery` (liens des photos), `ownerEmail` (pour identifier qui a déposé), `status`.
4. Pour publier : cliquer sur le champ **`status`**, remplacer la valeur `pending` par `published`, valider. L'annonce reste enregistrée telle quelle si vous préférez la refuser — supprimer le document entier (bouton `⋮` → « Delete document ») pour la retirer définitivement.
5. Les annonces `listings/` (Firestore, dynamiques, déposées par les hôtes) et `listings.json` (statique, annonces sélectionnées par nous) restent **deux sources séparées pour l'instant** — passer une annonce en `published` ne la fait pas encore apparaître dans le fil public de Séjours. Cette fusion (le fil doit lire les deux sources) reste à construire — à faire quand la première annonce hôte sera prête à passer en ligne.

Si une interface de validation directement dans l'app (liste des annonces en attente + bouton « Publier ») est préférable à la Firebase Console, c'est possible à construire — ça demande de savoir quel compte (quel e-mail Fiftin) doit avoir ce droit, pour le coder en dur à la fois côté règles Firestore et côté interface.

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

#### Paiement

Aucun paiement : les 3 formules envisagées (dépôt seul / + Fiftin essentiel / + Fiftin avancé) ne peuvent pas être facturées tant que Stripe n'est pas branché (voir « À faire avant un vrai passage en production » — pas encore fait non plus pour `app/`, la création d'entreprise est en cours). Le dépôt d'annonce est donc gratuit et non genré par formule pour l'instant.

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
    // seule la Firebase Console (accès admin, hors règles) peut repasser
    // status à "published" — pas d'interface pour ça côté application.
    match /listings/{listingId} {
      allow read: if resource.data.status == 'published'
        || (request.auth != null && resource.data.ownerUid == request.auth.uid);
      allow create: if request.auth != null
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.status == 'pending';
      allow update, delete: if request.auth != null
        && resource.data.ownerUid == request.auth.uid
        && request.resource.data.status == resource.data.status;
    }
  }
}
```

Cette règle dit : un document `accounts/XXXX` n'est lisible/modifiable que par la personne connectée dont l'identifiant Firebase est `XXXX` (le propriétaire) — sauf le sous-document `shared/ops`, également lisible par un compte Personnel qui lui est officiellement rattaché. Personne d'autre, même avec la configuration Firebase en main, ne peut y accéder. Pour `listings/{listingId}`, seul le propriétaire (`ownerUid`) peut créer/modifier/supprimer son annonce, tout le monde peut lire une annonce `published`, et personne côté application ne peut faire passer `status` de `pending` à `published` (règle `update` : le nouveau `status` doit rester égal à l'ancien) — cette bascule se fait uniquement à la main dans la Firebase Console.

**Important : sans ce nouveau bloc `listings/{listingId}` collé dans Firebase Console → Firestore Database → Règles, le dépôt d'annonce échoue silencieusement avec une erreur de permission** — les règles Firestore refusent par défaut tout ce qui n'est pas explicitement autorisé.

## À faire avant un vrai passage en production

- Paiement en ligne (Stripe) — essai gratuit 15 jours, puis abonnement réel.
- Étendre l'export/import JSON à l'ensemble des réglages (aujourd'hui seuls réservations/clients/événements sont couverts).
- Parcours de démarrage pour un nouveau compte (aujourd'hui on atterrit sur une grille vide avec des chambres génériques).
- Vérification d'e-mail à l'inscription (pas encore demandée).
- « Se connecter avec Google » (pas encore ajouté, volontairement, pour garder le premier lancement simple).
- Mentions légales, CGU/CGV, politique de confidentialité (page de présentation commerciale).
