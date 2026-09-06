# Fiftin

Outil de planning pour locations courte durée / chambres d'hôtes.

- `index.html` — page de présentation commerciale (fiftin.fr).
- `app/index.html` — l'outil complet (une seule page, pas de build) : fiftin.fr/app/.
- Déployé via GitHub Pages sur **fiftin.fr** (voir le fichier `CNAME`).
- Copie initiale de l'outil basée sur `lafermefanost/ferme-fanost/planning.html`, avec la marque renommée « Fifteen » → « Fiftin ».

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
  }
}
```

Cette règle dit : un document `accounts/XXXX` n'est lisible/modifiable que par la personne connectée dont l'identifiant Firebase est `XXXX` (le propriétaire) — sauf le sous-document `shared/ops`, également lisible par un compte Personnel qui lui est officiellement rattaché. Personne d'autre, même avec la configuration Firebase en main, ne peut y accéder.

## À faire avant un vrai passage en production

- Paiement en ligne (Stripe) — essai gratuit 15 jours, puis abonnement réel.
- Étendre l'export/import JSON à l'ensemble des réglages (aujourd'hui seuls réservations/clients/événements sont couverts).
- Parcours de démarrage pour un nouveau compte (aujourd'hui on atterrit sur une grille vide avec des chambres génériques).
- Vérification d'e-mail à l'inscription (pas encore demandée).
- « Se connecter avec Google » (pas encore ajouté, volontairement, pour garder le premier lancement simple).
- Mentions légales, CGU/CGV, politique de confidentialité (page de présentation commerciale).
