# L'argent mis de côté n'est pas de l'argent dépensé

Design, 2026-09-06. Chantier 1 sur quatre (les trois autres : abonnements
déclarés et pointés, faisabilité d'achat générique, audit complet).

## Le problème

`Transaction.is_transfer` existe depuis le premier jour et **tous** les moteurs
de flux l'excluent déjà : `aggregate.aggregate_series`,
`analytics._period_totals`, `common.recurrence_points`, `common.anomaly_points`,
`feasibility`, `runway`. Mais **rien ne le pose jamais**. Ni l'import, ni la
catégorisation. Les catégories `epargne` et `virement-interne` sont pourtant de
`kind == "transfer"` depuis `categorization/seed.py`, et ce fait ne se propage
nulle part.

Conséquence, pour l'opérateur : un virement de 300 EUR vers son livret est
compté comme une dépense de 300 EUR. Sa capacité d'épargne mesurée est
sous-estimée d'autant, et cette capacité alimente Faisabilité, Objectifs,
Projection et Trésorerie. Les intérêts de son livret, symétriquement, comptent
comme un revenu de trésorerie qu'il ne peut pas dépenser.

## La règle

Trois règles, dans cet ordre, la première qui répond gagne.

1. **Manuel.** Une nouvelle colonne `transfer_source` (`auto` | `manual`), sur
   le modèle de `category_source`. Une ligne marquée à la main par
   l'utilisateur ou par l'agent porte `manual` et aucune règle automatique ne
   la retouche, jamais.
2. **Catégorie.** `category.kind == "transfer"` — donc `Épargne et
   investissement` et `Virement interne` — pose `is_transfer = true`.
3. **Compte.** Sur un compte du périmètre épargne (`savings`, `pea`,
   `life_insurance`, `per`, `brokerage`, `crypto`), une opération **non
   catégorisée** est un mouvement de patrimoine, pas un flux : `is_transfer =
   true`. Une opération explicitement catégorisée revenu (les intérêts) ou
   dépense (les frais de gestion) **reste un flux** : c'en est un. Le compte ne
   décide qu'à défaut de catégorie.

La règle est pure : elle prend un `kind` de catégorie, un `kind` de compte et
une source, et rend un booléen. Aucune session, aucune horloge.

## Le troisième chiffre

Ni un quatrième moteur de flux, ni un ajout à la capacité mesurée.
`capacity.measure_savings_capacity` mesure `net_cents = entrées + sorties` sur
les lignes **non-transfert**. Dès que l'épargne est un transfert, l'argent viré
au livret **est déjà compté comme épargné** : il reste dans le net puisque plus
rien ne l'en sort. L'additionner le compterait deux fois.

Donc trois chiffres, jamais additionnés :

| | |
|---|---|
| Capacité mesurée | revenus − dépenses, ce que le mois dégage |
| Mis de côté | ce qui est réellement parti vers l'épargne |
| Écart | le surplus resté à dormir sur le compte courant, ou l'épargne financée à découvert |

Le troisième est celui qui a de la valeur : il dit si le surplus théorique
atterrit quelque part.

### Comment « mis de côté » se mesure

Voie catégorie d'abord, compte en rattrapage, jamais les deux sur le même
mouvement.

* **(a)** Les **débits** catégorisés `Épargne et investissement`, portés par un
  compte **hors** périmètre épargne. C'est le versement vu du côté qui sort, et
  c'est le côté qui est certain d'être importé.
* **(b)** Plus les **crédits** reçus sur un compte du périmètre épargne qui
  n'ont **pas** de miroir en (a) : même montant, même mois. Une différence de
  multiensembles par mois, pas un moteur d'appariement. Ça rattrape les
  versements venus d'un compte absent de Yieldo sans jamais compter deux fois
  le même euro.

Un mois sans épargne vaut `0`, jamais `null` : c'est une mesure, pas une
absence de mesure.

## Les commandes

* Bascule « inclure les virements internes » en tête de **Transactions**,
  **Analyse** et **Trésorerie**. `off` par défaut. Les moteurs acceptent déjà
  `include_transfers` ; c'est l'API et l'écran qui ne l'exposent pas.
* Sur chaque ligne de Transactions, un contrôle « virement interne » sans ouvrir
  le détail. Il pose `transfer_source = "manual"`.

## La reprise de l'existant

Une migration Alembic ajoute `transfer_source` et applique les règles 2 et 3 à
tout l'historique. Toute ligne déjà `is_transfer = true` au moment de la
migration devient `manual` et n'est pas touchée : c'est le marquage de
l'utilisateur ou de l'agent, et il tient.

## Ce qui bouge en aval

Rien à réécrire. Les moteurs filtrent déjà. Ils vont recevoir la vérité pour la
première fois, et les verdicts de faisabilité comme les dates d'objectif vont
changer — dans le bon sens.

## Tests

* Règle : catégorie transfert bascule ; compte d'épargne non catégorisé
  bascule ; intérêt catégorisé revenu ne bascule pas ; `manual` ne bascule
  jamais.
* Migration : les trois cas ci-dessus sur des lignes réelles, plus une ligne
  `is_transfer = true` préexistante qui ressort `manual` et intacte.
* Mis de côté : versement visible des deux côtés compté une fois ; versement
  d'un compte non importé compté ; mois sans épargne à `0` et non `null`.
* Non-régression du double comptage : `capacité != capacité + mis de côté`.
