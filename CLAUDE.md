# Fiftin — Instructions pour Claude

Ce dépôt contient **deux projets distincts** qui partagent la même marque. Avant toute modification, vérifier explicitement lequel est concerné — ne jamais reporter par erreur une modification destinée à l'un sur les fichiers de l'autre.

## `app/` — Fiftin, l'outil de planning (en production)

Outil de planning pour hébergeurs (calendrier de réservations, fichier client, comptabilité). C'est l'application existante, utilisée par de vrais clients payants.

- `index.html` (racine) — page d'accueil Fiftin « deux univers » (Séjours / Planning) : fiftin.fr/.
- Page commerciale Fiftin Planning : fiftin.fr/planning/ = `planning/index.html`, page autonome (`hotes/` y renvoie).
- Pictogramme Fiftin toujours visible en haut de Séjours, de Planning et de l'outil : lien de retour vers l'accueil fiftin.fr/ (l'accueil n'a que son grand logo).
- `app/index.html` — l'outil lui-même : fiftin.fr/app/.
- Voir le reste de ce README pour l'architecture (Firebase, comptes, règles Firestore, formules).
- **Ne pas modifier sans consigne explicite** portant sur le planning : c'est un produit en usage réel, une régression a un impact direct sur des clients.

## `sejours/` — Fiftin Séjours, l'annuaire de réservation directe (nouveau projet)

Annuaire mobile-first de location courte durée en réservation directe pour les voyageurs : recherche filtrée (distance, lieu, prix, prestations), fiches détaillées, contact hôte pré-rempli (WhatsApp / SMS / appel).

- `sejours/index.html` — l'application complète (une seule page, pas de build) : fiftin.fr/sejours/.
- Chemins écrits depuis la racine du site grâce à `<base href="/">` en tête du fichier.
- Prototype front-end : données d'hébergements mockées, aucun backend, aucune donnée réelle.
- Reprend volontairement la DA de `app/` (palette, typographies Jost + Fraunces italique, logo) pour une cohérence de marque immédiate — voir les tokens CSS (`:root`) en tête de `sejours/index.html`.

## DA commune des pages publiques (accueil, Séjours, Planning — pas l'outil)

- Palette : mêmes jetons partout (`--cream #EFEEEA`, `--sauge #354B38`, `--sauge-mid`, `--sauge-light`, `--lavender*`, `--yellow*`, `--muted #6F6C62`), identiques à Séjours et à l'outil.
- Police : Jost uniquement sur l'accueil et Planning (Fraunces italique reste propre aux accroches d'annonces dans Séjours).
- Sur-titre 12,5 px / 600 / interlettrage 0,2em / capitales ; titres h2 `clamp(30px,3.8vw,44px)` 600 ; texte 16,5 px `--muted` ; boutons pilules 15×24 px, 16 px 600 (jaune, sauge, blanc, verre).
- Vidéo de marque réservée aux heros, même voile vert (`rgba(29,40,32,.20→.32→.24)`), image fixe de secours.
- Fonds : hero vidéo → zones blanc / crème qui se chevauchent avec coins arrondis de 44 px → zone finale vert sauge avec le pied de page commun (`.da-foot`). Cartes : dégradés sauge (#EDF1E8→#E3E9DE) et lavande (#EEF0FA→#E2E6F6), rayon 28 px.
- Logo en verre : proportions de l'écran d'arrivée de l'outil (coins 25 %, lettrage 61 % décalé de −3 %). Téléphones : uniquement la maquette maison `.da-phone`, cadre noir très fin (coins arrondis, liseré clair, ombre douce, droit) avec les captures d'écran `assets/screen-*.webp` dedans — plus aucune maquette réaliste.

## Relation entre les deux projets

- Marque commune, codebases indépendantes : un changement dans `sejours/` ne doit jamais toucher `app/` ni `index.html` (racine), et inversement, sauf demande explicite couvrant les deux.
- Roadmap connue, **pas encore implémentée** : les deux doivent à terme communiquer pour que la disponibilité affichée dans `sejours/` reflète le calendrier de réservations géré dans `app/`. Ne pas construire cette intégration sans consigne explicite — c'est une étape future, pas un prérequis des tâches actuelles.
