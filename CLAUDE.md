# Fiftin — Instructions pour Claude

Ce dépôt contient **deux projets distincts** qui partagent la même marque. Avant toute modification, vérifier explicitement lequel est concerné — ne jamais reporter par erreur une modification destinée à l'un sur les fichiers de l'autre.

## `app/` — Fiftin, l'outil de planning (en production)

Outil de planning pour hébergeurs (calendrier de réservations, fichier client, comptabilité). C'est l'application existante, utilisée par de vrais clients payants.

- `index.html` (racine) — page de présentation commerciale de l'outil.
- `app/index.html` — l'outil lui-même : fiftin.fr/app/.
- Voir le reste de ce README pour l'architecture (Firebase, comptes, règles Firestore, formules).
- **Ne pas modifier sans consigne explicite** portant sur le planning : c'est un produit en usage réel, une régression a un impact direct sur des clients.

## `sejours/` — Fiftin Séjours, l'annuaire de réservation directe (nouveau projet)

Annuaire mobile-first de location courte durée en réservation directe pour les voyageurs : recherche filtrée (distance, lieu, prix, prestations), fiches détaillées, contact hôte pré-rempli (WhatsApp / SMS / appel).

- `sejours/index.html` — l'application complète (une seule page, pas de build) : fiftin.fr/sejours/.
- Prototype front-end : données d'hébergements mockées, aucun backend, aucune donnée réelle.
- Reprend volontairement la DA de `app/` (palette, typographies Jost + Fraunces italique, logo) pour une cohérence de marque immédiate — voir les tokens CSS (`:root`) en tête de `sejours/index.html`.

## Relation entre les deux projets

- Marque commune, codebases indépendantes : un changement dans `sejours/` ne doit jamais toucher `app/` ni `index.html` (racine), et inversement, sauf demande explicite couvrant les deux.
- Roadmap connue, **pas encore implémentée** : les deux doivent à terme communiquer pour que la disponibilité affichée dans `sejours/` reflète le calendrier de réservations géré dans `app/`. Ne pas construire cette intégration sans consigne explicite — c'est une étape future, pas un prérequis des tâches actuelles.
