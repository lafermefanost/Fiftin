# Fiftin

Outil de planning pour locations courte durée / chambres d'hôtes.

- `index.html` — l'outil complet (une seule page, pas de build).
- Déployé via GitHub Pages sur **fiftin.fr** (voir le fichier `CNAME`).
- Copie initiale basée sur `lafermefanost/ferme-fanost/planning.html`, avec la marque renommée « Fifteen » → « Fiftin ».

## État actuel

Cette copie est **vide** au départ (aucune réservation) : elle vit sur un nouveau nom de domaine, donc dans un nouvel espace de stockage du navigateur, séparé de celui utilisé sur lafermefanost.com. Le planning en production pour La Ferme Fanost reste sur **lafermefanost.com** tant que ce dépôt n'est pas prêt pour un usage quotidien multi-comptes.

## Sécurité — fait cette nuit

- **Code d'accès de l'appareil** : un écran demande un code avant d'ouvrir l'outil (défini à la première ouverture, modifiable dans Réglages → Sécurité). C'est une protection légère côté écran uniquement — voir le commit et les commentaires dans le code (`checkAccessGate`) pour le détail exact de ce que ça protège et ne protège pas.
- **Règles Firestore recommandées** : le modal "Synchronisation" affiche maintenant un avertissement + les règles à coller dans la console Firebase, pour restreindre l'accès au seul document utilisé par ce planning plutôt que de laisser le projet grand ouvert.
- **Limite honnête à garder en tête** : sans vrai système de connexion (Firebase Authentication non intégré), ces deux protections ne remplacent pas un vrai contrôle d'accès par compte. Elles réduisent significativement le risque (fini l'accès à qui a juste le lien, fini le projet Firebase grand ouvert) mais quelqu'un qui aurait la configuration Firebase en main pourrait encore contourner les deux. Une vraie isolation par compte demandera d'intégrer Firebase Authentication plus tard — tâche à part, plus lourde, à ne pas faire à la légère.

## À faire avant un vrai passage en production

- Étendre l'export/import JSON à l'ensemble des réglages (aujourd'hui seuls réservations/clients/événements sont couverts).
- Parcours de démarrage pour un nouveau compte (aujourd'hui on atterrit sur une grille vide avec des chambres génériques).
- Support multi-comptes (aujourd'hui : un compte = un déploiement + un projet Firebase dédié) — la vraie isolation par compte demandera Firebase Authentication (voir ci-dessus).
