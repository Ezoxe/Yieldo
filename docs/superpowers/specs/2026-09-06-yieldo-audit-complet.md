# Audit complet de Yieldo, sur un vrai grand livre

2026-09-06. Chantier 4 sur quatre.

## Comment cet audit a été fait

Pas sur l'aperçu. `?apercu=1` est un stub de `fetch` avec des données
fabriquées : un chiffre qu'il affiche ne prouve rien sur les moteurs.

Un compte a été créé contre la **vraie** application, puis rempli à travers les
**vraies** routes : deux comptes (courant et Livret A), **18 mois** et
**325 opérations** — salaire, loyer, électricité qui bouge, téléphonie, deux
abonnements, mutuelle, assurance, un virement mensuel au livret vu des deux
côtés, quatre courses par mois, carburant, restaurant, sport, une mensualité de
crédit auto — plus six récurrences déclarées avec trois pointages, quatre
budgets, deux objectifs et une dette. Puis chaque route GET a été relue.

Tout ce qui suit est mesuré sur ces chiffres-là.

## Ce qui a été corrigé pendant l'audit

### 1. Les budgets ignoraient les dépenses de leurs sous-catégories

**Gravité : critique.** L'écran Budgets affichait `0,00 €` dépensé sur
**toutes** les lignes, et aucune alerte de dépassement ne pouvait jamais se
déclencher.

L'arbre de catégories livré range chaque dépense sur une **feuille** —
« Courses », « Carburant », « Énergie » — alors que l'endroit naturel pour
poser un budget est le **parent** : « Alimentation », « Transport »,
« Logement ». `api/budgets.py` lisait `spent_by_category.get(category.id, 0)`,
c'est-à-dire les seules lignes rangées directement sur le parent. Il n'y en a
jamais.

Mesuré avant/après sur le mois d'août 2026 du grand livre de test :

| Ligne | Avant | Après |
|---|---|---|
| Transport (budget 120 €) | 0,00 € — « ok » | −291,00 € — **dépassé de 171 €** |
| Alimentation (budget 420 €) | 0,00 € — « ok » | −381,62 € — 91 % du plafond |
| Abonnements (budget 40 €) | 0,00 € | −26,98 € |
| Loisirs (budget 90 €) | 0,00 € | −29,19 € |

Et l'écran Alertes, qui calculait la dépense **une seconde fois** avec le même
défaut, ne levait rien. Il lève maintenant : *« Budget dépassé : Transport —
291,00 € dépensés sur un budget mensuel de 120,00 €, soit 242 % du plafond. »*

Le calcul est devenu `common.budget_owner` / `common.rolled_budget_spend`,
partagé par les deux écrans : un budget dépassé sur l'un doit être celui sur
lequel l'autre alerte. Une sous-catégorie qui porte **son propre** budget reste
comptée dans sa ligne à elle et pas aussi dans celle du parent — sinon le même
euro tient dans deux lignes. Elle disparaît aussi de la liste « hors budget » :
elle a bien été budgétée, à travers son parent.

Cinq tests dans `backend/tests/test_budget_rollup_api.py`, dont celui qui
attache l'écran à l'alerte.

### 2. « Coût des abonnements » annonçait 8,6 fois le vrai montant

**Gravité : élevée.** Le panneau titrait « Coût des abonnements » et affichait
**20 492,56 € par an**. Les abonnements réels de ce foyer — Netflix, Spotify,
Free, mutuelle, assurance habitation, EDF — font **2 368 €**.

Ce qu'il y mettait :

| Ligne détectée | Rythme | Coût annuel |
|---|---|---|
| Loyer | mensuel | 9 360,00 € |
| **Courses (CB CARREFOUR MARKET)** | **hebdomadaire** | **4 435,60 €** |
| Crédit auto | mensuel | 2 940,00 € |
| Carburant | mensuel | 612,00 € |
| Restaurant | mensuel | 432,00 € |
| Decathlon | mensuel | 344,40 € |

Aucune de ces lignes n'est une erreur de détection : ce sont toutes de vraies
récurrences, y compris quatre passages en caisse par mois que le moteur lit —
correctement — comme un rythme hebdomadaire. C'est le **titre** qui était faux.
`engines/recurrence.py` détecte un rythme, jamais une nature, et il n'a aucun
moyen honnête de savoir qu'un loyer n'est pas un abonnement.

Corrigé par le seul geste défendable : le panneau s'appelle désormais **« Coût
de vos dépenses récurrentes »** et dit en toutes lettres qu'un loyer et des
courses hebdomadaires en font partie. Pour connaître le coût des abonnements
précisément, il faut les **déclarer** — ce que le chantier 2 rend possible, et
c'est le seul endroit où l'information existe : elle vient du foyer, pas d'une
inférence.

## Ce qui a été trouvé, arbitré et corrigé

### 3. La prévision de trésorerie refuse sur un foyer régulier

Sur ces 18 mois, `/api/cashflow/forecast` renvoie **zéro mois projeté** :

> « Prévision impossible : l'historique couvre 16 mois complets, mais un seul
> porte des opérations non récurrentes — il en faut au moins 6 pour mesurer la
> part variable des dépenses. »

Le refus est honnête et le raisonnement est juste : sans opérations
non-récurrentes, il n'y a pas de marge d'erreur à estimer. Mais la conséquence
est perverse — **plus un foyer est régulier, moins l'écran Trésorerie lui sert**,
alors que c'est exactement le foyer dont la trésorerie est la plus prévisible.

**Corrigé.** Il y a désormais une projection **sans bande**. Deux causes la
produisent, chacune avec sa phrase :

* tout est récurrent — la projection porte les seules charges connues, et dit
  en toutes lettres que la part variable en est **absente**, pas estimée à
  zéro : « le solde réel sera plus bas de ce que vous dépensez en dehors de ces
  lignes » ;
* le résidu est mesurable mais parfaitement plat — la projection est complète
  et exacte, seule la marge d'erreur manque.

Dans les deux cas `balance_p10 == balance_p50 == balance_p90`, les deux séries
de bande sont **retirées du graphe** au lieu d'être aplaties (un ruban de
hauteur nulle reste un ruban), l'entrée de légende part avec elles, et
l'infobulle dit « Aucune fourchette : rien n'a pu être mesuré autour de ce
chiffre ». La phrase de dépassement perd son « pourrait », qui appartenait à
une borne basse qui n'existe plus.

Un historique trop court, lui, refuse toujours : importer des relevés le
corrige, et une projection bâtie sur deux mois serait l'invention que ce moteur
existe pour refuser. Un historique long sans résidu **ni** récurrence refuse
aussi — ce n'est pas un foyer régulier, c'est un foyer vide.

### 4. Le Patrimoine ignore les comptes d'épargne

Le Livret A du foyer porte **9 912,40 €**. L'écran Patrimoine affiche
**0,00 €**, et zéro position.

Il y a deux notions de compte dans le modèle, sans pont entre elles :
`models/account.py` (`Account`, avec ses `kind` dont `savings`, `pea`,
`life_insurance`, `per`) et `models/investment_account.py`
(`InvestmentAccount`), et `/api/portfolio/*` ne lit que la seconde. Un foyer
qui a importé son livret le voit dans ses soldes et pas dans son patrimoine.

**Corrigé.** `/api/portfolio/valuation` publie une troisième section, `cash`,
à côté des positions et des montants déclarés : les comptes du périmètre
`engines/transfer.SAVINGS_ACCOUNT_KINDS` — le même ensemble qui décide déjà de
ce que « mettre de côté » veut dire —, au solde que leurs propres opérations
additionnent.

Section à part, jamais fondue dans les positions : un cours de bourse, un
montant recopié d'un relevé et une somme de mouvements sont trois genres de
nombres, et chacun dit autre chose sur la confiance qu'on peut lui faire. Le
solde s'ajoute au total et **à rien d'autre** — une balance bancaire n'a pas de
prix de revient, l'inclure dans `cost_basis_cents` inventerait une plus-value.
Un compte archivé, ou que le foyer a explicitement sorti de son patrimoine, en
reste dehors. Un compte courant aussi : c'est l'argent sur lequel on vit, et sa
place est en Trésorerie.

L'écran l'itemise avec son nombre d'opérations — un solde bâti sur quatre
lignes et un solde bâti sur quatre cents sont le même nombre avec un crédit
très différent — et dit « solde initial, aucune opération importée » quand
c'est le cas.

### 5. Six écrans n'ont aucune donnée dans l'aperçu

`?apercu=1` répond `501 — n'est pas simulé dans ce mode` sur :

| Écran | Route manquante |
|---|---|
| Alertes | `/api/alerts` |
| Patrimoine | `/api/portfolio/accounts`, `/lots`, `/valuation` |
| Projection | `/api/projection` |
| Export IA | `/api/export/options`, `/api/export/templates` |
| Import | `/api/imports/profiles` |
| Réglages | `/api/imports` |

`/api/feasibility/*` en faisait partie ; il est simulé depuis le chantier 3.
CLAUDE.md dit de juger une interface dans un navigateur avant de la déclarer
finie ; sur ces six écrans, personne ne pouvait.

**Corrigé.** Les six répondent. Les fixtures des tests sont réutilisées telles
quelles plutôt que réécrites — elles décrivent déjà le même foyer, et deux jeux
de données pour un écran finissent toujours par diverger. Vérifié en parcourant
les **22 routes** de l'application dans le navigateur avec `fetch` instrumenté :
zéro réponse non-2xx, zéro bandeau d'erreur.

### 6. L'alerte de hausse de prix se déclenche sur du bruit

La seule alerte levée par ce grand livre, avant la correction des budgets, est
une hausse de **+2,2 %** sur « CB DECATHLON » : de 28,07 € à 28,70 €, soit
**63 centimes**. Le plancher de `recurrence.PRICE_CHANGE_MIN_RATIO` est à 2 %,
ce qui est censé écarter « un arrondi, un ajustement de TVA ou un mois
partiel ». À 63 centimes sur un poste de loisirs, l'alerte est vraie et sans
valeur.

**Corrigé.** `PRICE_CHANGE_MIN_ANNUAL_CENTS = 1 200` : une hausse qui coûte
moins de douze euros **sur un an** n'est pas signalée, quel que soit son
pourcentage. Douze euros, c'est un euro par mois — la plus petite hausse sur un
prélèvement mensuel qui appelle une décision.

Jugée sur l'année et non par échéance, parce que ce n'est pas le même fait :
63 centimes une fois par mois font 7,56 € par an et ne changent rien, les mêmes
63 centimes chaque semaine font 32,76 € et sont une vraie dérive. Le plancher
par échéance en est donc déduit, rythme par rythme. Et une hausse écartée
n'existe pas : le niveau retenu redevient la médiane de toute la série, puisque
les deux niveaux ont été jugés n'en former qu'un.

## Ce qui a été vérifié et tient

* **L'épargne n'est plus une dépense** (chantier 1), sur données réelles :
  entrées 53 580,40 €, sorties −30 240,15 €, net 23 340,25 €, **mis de côté
  5 400,00 €** — soit exactement 18 × 300 €, compté **une seule fois** alors
  que le virement figure des deux côtés dans le grand livre. Écart
  17 940,25 €. Et `/api/accounts/balance` confirme l'appariement :
  `received 540 000, sent −540 000, unmatched 0`.
* **Les récurrences déclarées** : les six déclarations reviennent, le
  calendrier d'août 2026 pose les bonnes échéances, et l'électricité passe bien
  en `observed` après trois pointages.
* **La capacité d'épargne** : 1 298,71 €/mois médiane, bande 1 262,72 –
  1 334,70 €, mesurée sur 16 mois complets. Cohérente avec le net mensuel de la
  série (≈ 1 300 €).
* **L'autonomie** : 17,6 mois au rythme normal (1 682,27 €/mois), 22,0 mois au
  rythme des seules dépenses essentielles (1 345,62 €/mois), sur 21 catégories
  marquées essentielles. Les deux burns sont cohérents entre eux et avec la
  série.
* **Les objectifs** : « Fonds d'urgence » à 56 % dans les temps, « Voyage
  Japon » à 13 % **hors délai** — et le moteur le dit, avec sa date projetée au
  30 avril 2027 contre une échéance au 1er avril. Financement séquentiel : le
  second ne démarre qu'après trois mois, ce que `funding_starts_in_months`
  publie.
* **Les anomalies** : zéro détectée sur 12 groupes analysés, avec une catégorie
  écartée pour sous-effectif et sa raison nommée. Un moteur qui ne crie pas sur
  des données propres.
* **L'inflation** : le loyer, l'assurance et la téléphonie ressortent à
  **0,00 %**, ce qui est exact — ces montants n'ont pas bougé de 18 mois.

## Ce qui manque comme information, écran par écran

* **Budgets** — aucun total « budgété » face au total dépensé du mois.
  `total_budget_cents` (670,00 €) et `total_spent_cents` (−1 671,69 €) sont
  publiés mais mesurent deux choses différentes : le second est **tout** le
  mois, budgété ou non. Deux chiffres du même nom qui ne se comparent pas.
* **Soldes** — `liquid_total_cents` compte le Livret A comme liquide. Pour un
  Livret A c'est défendable, pour un PEA beaucoup moins, et c'est ce total qui
  alimente le « solde disponible » de la Faisabilité. Le périmètre mériterait
  d'être nommé à l'écran.
* **Récurrences détectées** — rien ne dit combien de lignes sont des sorties
  contre des entrées, alors que le salaire (35 688 €/an) domine la liste triée
  par montant absolu.
* **Plan prévisionnel** — vide et sans phrase : l'écran ne dit pas qu'il
  attend une déclaration. C'est le seul état vide non expliqué rencontré.

## Suites tests

Backend 1 919 tests passés (6 ignorés), front 1 351, `npm run build` sans
erreur TypeScript. Les 22 routes de l'application parcourues dans le
navigateur : aucune réponse non-2xx, aucun bandeau d'erreur.
