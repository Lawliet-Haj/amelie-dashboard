# Modèles Brevo — facturation préventive

Sauvegardes des modèles e-mail utilisés par `EL - Dashboard Facturation Send Mail`
(`920RrJXEtRYGZg0h`). Récupérés et réécrits par l'API Brevo le **2026-09-03**.

| Modèle | Palier | Nom Brevo | Sujet enregistré |
|---|---|---|---|
| **337** | J-30 | `Mail relance 1_copy` | `Mail relance 1` |
| **336** | J-15 | `Mail RAPPEL` | `Mail RAPPEL` |

## Pourquoi ces fichiers existent

Les modèles ne vivaient que dans Brevo. Une modification par l'API réécrit
`htmlContent` **sans historique** : sans copie ici, une erreur serait irréversible.

- `template-<id>-avant.html` — état d'origine, avant toute intervention.
- `template-<id>-apres.html` — état actuel en production.

Pour restaurer : `PUT /v3/smtp/templates/<id>` avec `{ "htmlContent": <contenu du -avant> }`.

## Ce qui a été changé le 2026-09-03

Les modèles référençaient **`contact.NOM`** et **`contact.NOM_COMPLET`**. Ces variables
ne se résolvent que pour une patiente existant comme **contact** dans Brevo — les nôtres
viennent d'ORTHOP et n'en sont pas. Elles rendaient donc **vide**.

Remplacées par **`params.nom`** et **`params.nom_complet`**, que le workflow d'envoi
transmet dans la charge utile transactionnelle.

| Modèle | Avant | Après |
|---|---|---|
| 337 | `Madame {{ contact.NOM }}` | `Madame {{ params.nom }}` |
| 337 | `{{ contact.NOM_COMPLET }}` (cellule voisine) | `{{ params.nom_complet }}` |
| 336 | `Madame {{ contact.NOM }} ,` | `Madame {{ params.nom }} ,` |

⚠️ **L'ordre de substitution compte** : `contact.NOM_COMPLET` contient `contact.NOM`
comme préfixe. Remplacer le motif court d'abord produirait `params.nom_COMPLET`.

## ⚠️ Deux points de CONTENU non corrigés — décision du client

1. **Le 337 affiche deux variables de nom à la suite** : `Bonjour` / `Madame {{ params.nom }}`
   / puis une cellule voisine `{{ params.nom_complet }}`. Avec de vraies données, cela se lit
   « Bonjour Madame Aubry Marine Aubry ». Vraisemblablement un reste de construction. Non
   touché : choisir entre « Madame Aubry » et « Madame Marine Aubry » est une décision
   éditoriale.
2. **Le 336 porte une espace avant la virgule** (`Madame Aubry ,`), fautive en typographie
   française.

## ⚠️ Le sujet enregistré est un libellé interne

« Mail relance 1 » et « Mail RAPPEL » sont ce que la patiente verrait dans sa boîte. Le
workflow d'envoi le **remplace** à l'envoi (`SUJETS` dans `Preparer Envois`) ; les modèles
eux-mêmes n'ont pas été modifiés sur ce point. Un envoi lancé depuis l'interface Brevo
partirait donc avec le mauvais sujet.
