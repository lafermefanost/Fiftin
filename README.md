# Fiftin

Outil de planning pour locations courte durée / chambres d'hôtes.

- `index.html` — l'outil complet (une seule page, pas de build).
- Déployé via GitHub Pages sur **fiftin.fr** (voir le fichier `CNAME`).
- Copie initiale basée sur `lafermefanost/ferme-fanost/planning.html`, avec la marque renommée « Fifteen » → « Fiftin ».

## État actuel

Cette copie est **vide** au départ (aucune réservation) : elle vit sur un nouveau nom de domaine, donc dans un nouvel espace de stockage du navigateur, séparé de celui utilisé sur lafermefanost.com. Le planning en production pour La Ferme Fanost reste sur **lafermefanost.com** tant que ce dépôt n'est pas prêt pour un usage quotidien multi-comptes.

## À faire avant un vrai passage en production

- Ajouter un contrôle d'accès (mot de passe/PIN) — actuellement aucune protection.
- Sécuriser les règles Firestore côté Firebase (voir le modal "Synchronisation" dans l'outil).
- Étendre l'export/import JSON à l'ensemble des réglages (aujourd'hui seuls réservations/clients/événements sont couverts).
- Parcours de démarrage pour un nouveau compte (aujourd'hui on atterrit sur une grille vide avec des chambres génériques).
- Support multi-comptes (aujourd'hui : un compte = un déploiement + un projet Firebase dédié).
