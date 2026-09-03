# Modèles Brevo — facturation préventive

Sauvegardes des modèles e-mail utilisés par `EL - Dashboard Facturation Send Mail`
(`920RrJXEtRYGZg0h`). Récupérés et réécrits par l'API Brevo le **2026-09-03**.

| Modèle | Palier | Nom Brevo |
|---|---|---|
| **337** | J-30 | `Mail relance 1_copy` |
| **336** | J-15 | `Mail RAPPEL` |

## Pourquoi ces fichiers existent

Les modèles ne vivaient que dans Brevo. Une modification par l'API réécrit
`htmlContent` **sans aucun historique** : sans copie ici, une erreur serait irréversible.

- `template-<id>-avant.html` — état d'origine, avant toute intervention.
- `template-<id>-apres.html` — état actuel en production.

Pour restaurer : `PUT /v3/smtp/templates/<id>` avec `{ "htmlContent": <contenu du -avant> }`.

## Ce qui a été corrigé le 2026-09-03

### 1. Les variables de nom ne se résolvaient pas

Les modèles référençaient **`contact.NOM`** et **`contact.NOM_COMPLET`**. Ces variables ne
sont résolues que pour une patiente existant comme **contact** dans Brevo — les nôtres
viennent d'ORTHOP et n'en sont pas. Elles rendaient donc **vide**.

⚠️ **L'ORDRE DE SUBSTITUTION COMPTE** : `contact.NOM` est un **préfixe** de
`contact.NOM_COMPLET`. Traiter le motif court d'abord produit `params.nom_COMPLET`, une
variable inexistante — donc la même panne, en plus silencieuse.

### 2. Le 337 affichait deux noms à la suite

`Madame {{ contact.NOM }}` puis, en texte libre dans la **même cellule**,
`{{ contact.NOM_COMPLET }}` : « Bonjour Madame Aubry Marine Aubry ». Reste de construction.
Le client a choisi la forme **nom complet** ; la variable en trop a été retirée et le J-15
aligné sur la même forme.

### 3. ⚠️ Une date de fin FIGÉE dans les deux corps

C'était le défaut le plus grave, et il ne se voyait pas dans la liste des variables :

| Modèle | Date codée en dur |
|---|---|
| 337 | `Votre ordonnance actuelle prendra fin le **20/10/2026**.` |
| 336 | `Votre ordonnance actuelle prendra fin le **05/09/2026**` |

**Toutes les patientes auraient lu la même date, fausse**, et contradictoire avec celle de
l'objet du mail et celle du SMS. Remplacées par `{{ params.date_fin }}`.

### 4. Le sujet enregistré était un libellé interne

« Mail relance 1 » et « Mail RAPPEL » — ce que la patiente aurait vu dans sa boîte.

| Modèle | Sujet enregistré désormais |
|---|---|
| 337 | `Votre ordonnance prendra fin le {{ params.date_fin }} : pensez au renouvellement` |
| 336 | `RAPPEL : votre ordonnance prendra fin le {{ params.date_fin }}` |

Le verbe suit celui du **corps** (« prendra fin le ») et non celui du SMS (« expire le ») :
dans un même message, l'objet et le texte doivent se répondre. Le préfixe « RAPPEL » du
J-15 reprend celui de son corps et de son SMS.

### 5. Deux espaces fautives avant une virgule

`Madame … ,` et `… fin le … , afin de` dans le 336. Corrigées.

## ⚠️ Le sujet existe en DEUX endroits — les modifier ensemble

| Où | Forme | Qui l'utilise |
|---|---|---|
| nœud `Preparer Envois` du workflow d'envoi | `{date}` | **nos envois** (passé dans la charge utile, écrase celui du modèle) |
| champ `subject` du modèle Brevo | `{{ params.date_fin }}` | un envoi lancé depuis l'interface Brevo |

La duplication est assumée : lire le modèle à chaque envoi stockerait **86 Ko de HTML dans
chaque exécution n8n**, or la base de cette instance fait déjà 58,5 Go. Les deux valeurs
doivent être tenues identiques à la main.

## Variables attendues par les modèles

`params.nom_complet` et `params.date_fin`. Le workflow envoie aussi `nom`, `prenom`,
`date`, et leurs variantes en majuscules — des alias, pour qu'un changement de modèle ne
demande aucune intervention côté n8n.

⚠️ `params.date_fin` est la **fin de location**, c'est-à-dire la **veille** de
`facturation.date_echeance` (qui est l'« applicable du » d'ORTHOP). C'est exactement la
date utilisée par le SMS.

## ⚠️ Ce que Brevo ne permet PAS de vérifier sur ce compte

`GET /v3/smtp/emails` renvoie **0 résultat** : le journal transactionnel est anonymisé, comme
le sont déjà les champs `email`, `link` et `sending_ip` des webhooks. Le rendu réel d'un mail
(objet et date, variables résolues) **ne peut donc pas être relu par l'API** — la seule
vérification possible est de s'envoyer un exemplaire et de le regarder.
