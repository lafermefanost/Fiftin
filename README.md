# Fiftin

Outil de planning pour locations courte durée / chambres d'hôtes.

- `index.html` — l'outil complet (une seule page, pas de build).
- Déployé via GitHub Pages sur **fiftin.fr** (voir le fichier `CNAME`).
- Copie initiale basée sur `lafermefanost/ferme-fanost/planning.html`, avec la marque renommée « Fifteen » → « Fiftin ».

## Comptes et données — architecture définitive

Fiftin est multi-comptes : chaque client crée son propre compte (e-mail + mot de passe) et ne voit jamais les données d'un autre compte.

- **Connexion** : Firebase Authentication (e-mail + mot de passe). Pas encore de « Se connecter avec Google » — ajoutable plus tard sans rien casser.
- **Stockage** : un seul projet Firebase, centralisé, géré par nous, héberge tous les comptes clients. Chaque compte a son propre document Firestore (`accounts/{uid}`, `uid` = l'identifiant unique attribué par Firebase Authentication à la connexion).
- **Isolation réelle des données** : ce n'est pas seulement le code JS qui empêche un compte de voir les données d'un autre — ce sont les **règles Firestore côté serveur** (voir ci-dessous) qui refusent toute lecture/écriture hors de son propre document, quel que soit le client utilisé pour se connecter.
- **Poste partagé** : à la déconnexion, les données locales de l'appareil (localStorage) sont effacées immédiatement, pour qu'aucune trace du compte précédent ne reste visible à la personne suivante.
- **Mot de passe oublié** : un lien « Mot de passe oublié ? » envoie un e-mail de réinitialisation via Firebase.
- **Changer de mot de passe** : Réglages → Compte.

### Règles Firestore à appliquer (Firebase Console → Firestore Database → Règles)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /accounts/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Cette règle dit : un document `accounts/XXXX` n'est lisible/modifiable que par la personne connectée dont l'identifiant Firebase est `XXXX` — personne d'autre, même avec la configuration Firebase en main, ne peut y accéder.

## À faire avant un vrai passage en production

- Étendre l'export/import JSON à l'ensemble des réglages (aujourd'hui seuls réservations/clients/événements sont couverts).
- Parcours de démarrage pour un nouveau compte (aujourd'hui on atterrit sur une grille vide avec des chambres génériques).
- Vérification d'e-mail à l'inscription (pas encore demandée).
- « Se connecter avec Google » (pas encore ajouté, volontairement, pour garder le premier lancement simple).
