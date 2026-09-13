# Tour complet du 13 septembre 2026 : corrections et améliorations

Ce que le tour du logiciel (code, 22 écrans en 1440 px et 390 px, deux
thèmes) a trouvé, ce que l'opérateur a retenu, et la forme que prend chaque
chantier. Six chantiers, exécutés dans l'ordre A → F ; A, B et C sont
spécifiés ici en entier, D, E et F reçoivent chacun leur spec au moment où
ils commencent, avec les décisions déjà prises consignées à la fin.

Règles communes : une tâche = un commit ; le test rouge d'abord ; les
écrans sont jugés dans un navigateur, en 1440 et en 390, avant d'être
déclarés finis ; les montants restent des centimes entiers ; tout ce qui
est lu par un moteur reste pur.

## A — Corrections

| # | Défaut mesuré | Correction |
|---|---|---|
| A1 | `PlanPage` dit « le mode se change dans l'en-tête » ; il est dans Réglages → Lecture des chiffres. | Phrase corrigée, test qui la cherche. |
| A2 | `/categories` : 0 px entre `PageHead` et le bento (`.yd-categories` en `display:block`). | Root en flex column avec le gap partagé, comme les autres écrans. |
| A3 | Calendrier Récurrences : 560 px de large sur 390 px d'écran, vendredi–dimanche invisibles. | `.yd-rcal` dans un conteneur `overflow-x:auto` ; colonnes `minmax(80px, 1fr)` ; la page ne défile jamais horizontalement. |
| A4 | Faisabilité : labels non associés (nom accessible = placeholder) ; placeholder lu comme une valeur ; champ Échéance étiré quand l'erreur voisine apparaît. | `htmlFor`/`id` ; placeholder remplacé par une aide sous le champ ; `align-items:start` sur la grille. |
| A5 | Treemap : pill « Logement » sous le graphe à la racine. | Série nommée « Dépenses » ; breadcrumb masqué tant qu'aucun zoom n'a eu lieu. |
| A6 | Mobile : la sparkline de « Sorties » traverse le chiffre. | Sous 640 px la sparkline passe SOUS le chiffre, jamais derrière. |
| A7 | Mobile Transactions : date répétée sur chaque ligne, libellés tronqués. | Cellule date masquée sous 640 px ; l'en-tête de groupe porte la date. |
| A8 | Bundle initial 2 Mo (647 kB gzip) ; react-query monté, jamais utilisé. | `React.lazy` par route + `Suspense` ; `manualChunks` pour echarts ; hook `useApiQuery` (react-query, `staleTime` 30 s) adopté par Vue d'ensemble, Transactions, Budgets. Cible : chunk initial < 300 kB gzip. |

## B — UI/UX

| # | Changement |
|---|---|
| B1 | Menu utilisateur dans l'en-tête : bouton initiale → Réglages, thème (Système / Clair / Sombre), Se déconnecter. La section « Fin de session » de Réglages reste. |
| B2 | Mobile (< 768 px) : `BottomTabs` — Vue, Transactions, Budgets, Assistant, Plus (ouvre le tiroir). Transactions : `FilterBar` repliée derrière « Filtres (n actifs) », le sélecteur de période reste visible. |
| B3 | Alertes, Connexions, Patrimoine, Faisabilité : les paragraphes de méthode passent derrière `InfoTip` ou un `<details>` « Comment c'est calculé ». Le chiffre et la phrase de verdict restent. |
| B4 | Actions de liste (Récurrences, Objectifs, Dettes, Patrimoine) : icône + libellé court (« Modifier », « Supprimer »), `aria-label` complet (« Modifier Loyer »). |
| B5 | Import : « Supprimer cet import » devient tertiaire, avec confirmation inline (motif `pendingArchive` des Objectifs). |
| B6 | Panneaux à moitié vides : Dernières opérations passe à 10 lignes ; le donut Budgets porte sa liste sous lui ; « Lecture des chiffres » rejoint le panneau Apparence. |
| B7 | Analyse : le sélecteur de période, ignoré par deux panneaux sur trois, est retiré ; le bandeau qui l'avouait aussi. Chaque panneau nomme déjà sa période. |
| B8 | Trésorerie : « Prévision sur N mois », N dérivé des points reçus. |
| B9 | Skeletons : chaque écran en a un, de la forme du contenu (audit des 22). |
| B10 | Patrimoine : la section « Déclarer » est un `<details>` par compte, fermé par défaut sauf s'il n'y a qu'un compte. |
| B11 | Connexion et Inscription : `YieldoMark` + nom, lien « Accueil ». |
| B12 | = A8. |

## C — Fonctionnel léger

### C1 (F2) — Patrimoine net

`engines/networth.py`, pur : `NetWorth(assets_cents, debts_cents,
net_cents, breakdown)` à partir de la valorisation (positions, déclarés,
cash) et des dettes actives (capital restant dû). `NetWorthSnapshot`
(`user_id`, `taken_on`, `assets_cents`, `debts_cents`, `breakdown` JSON, un
par jour) écrit à l'ouverture de Patrimoine, comme `HealthSnapshot`.
`GET /portfolio/networth` renvoie la mesure du jour et l'historique. Écran :
panneau de tête « Patrimoine net » (actifs − dettes, chaque terme nommé) et
`NetWorthChart` (aire, un point par relevé).

### C2 (F3 sans e-mail) — Alertes visibles

`GET /alerts/count` (alertes en cours). Store `useAlertCount` sur le motif
de `useProposalCount` ; badge « n en cours » sur l'entrée Alertes de la
sidebar. Vue d'ensemble : panneau « Ce qui a changé » — alertes en cours
(titre, chiffre, lien), dernier import (« il y a N jours », lien Import).
Le digest e-mail est reporté au chantier F.

### C3 (F5) — Détection → déclaration

Sur une récurrence détectée : « Déclarer » pré-remplit `DeclarationForm`
(libellé, montant médian, rythme, prochaine échéance, catégorie). « Ce
n'est pas un abonnement » écrit `recurrence_dismissals(user_id, label_key)`
; `recurrence_points` exclut les libellés écartés ; Réglages liste les
écartés et permet de les rétablir.

### C4 (F6) — Budgets

Le rapport publie `budgeted_spent_cents` (dépensé sur les seules lignes
budgétées) ; l'écran affiche « Budgété 670,00 € · Dépensé sur ces lignes
1 023,00 € » côte à côte. Plafond éditable inline (PATCH catégorie).
`GET /budgets/history?months=6` ; sparkline six mois par ligne.

### C5 (F7) — Indice INSEE embarqué

`backend/app/data/ipc_insee.csv` : IPC ensemble des ménages, base 100 en
2015, un point par mois, jusqu'au dernier mois publié au moment du commit
(source nommée dans l'en-tête du fichier). `POST /analysis/price-index/insee`
copie la série dans l'indice de l'utilisateur. Bouton « Utiliser l'indice
INSEE embarqué (jusqu'à AAAA-MM) » ; la saisie manuelle reste.

### C6 (F9) — Objectif ↔ compte

`Goal.account_id` nullable, unique par compte. Renseigné : `saved_cents`
est le solde du compte (`opening_balance_cents` + mouvements), en lecture
seule, badge « mesuré » ; vide : déclaré comme aujourd'hui.

### C7 (F11) — OFX, QIF, dépôt global, dernier import

`importers/ofx.py` et `importers/qif.py`, purs, produisent les mêmes lignes
que le parseur CSV ; l'étape « Colonnes » est sautée, aperçu et
déduplication restent. Bouton « Importer » dans l'en-tête (mobile : dans
Plus). `GET /imports/last` ; Vue d'ensemble affiche « Dernier import il y a
N jours » (panneau C2).

### C8 (F12) — Export CSV

`GET /transactions/export.csv`, mêmes filtres que la liste, UTF-8 avec BOM,
séparateur `;`, montants en euros à deux décimales. Bouton « Exporter CSV »
sur Transactions.

## D, E, F — décisions prises, specs à venir

- **D (F1) Fusion des déclarations.** Une seule source : `plan_lines` est
  supprimée par migration — ses lignes `fixed` deviennent des récurrences
  déclarées, ses `envelope` des budgets de catégorie. Le Plan prévisionnel
  lit récurrences + budgets et ne déclare plus rien ; `engines/plan` garde
  son entrée `PlanLine`, assemblée par `api/common.plan_lines`. L'outil
  agent `proposer_ligne_plan` devient `proposer_recurrence`.
- **E (F10) Foyer partagé.** Invitation par email, lecture seule.
  `get_current_user` résout le propriétaire quand l'acteur a choisi « voir
  le foyer de… » ; toute méthode non GET est refusée (403 nommé). Réglages →
  Foyer : inviter, révoquer, basculer. `get_session_user` agit toujours sur
  l'acteur.
- **F.** Scission (`transaction_splits`, somme contrainte au montant de
  l'opération, agrégats par catégorie lisent les parts, solde lit
  l'opération) ; sélection multiple + recatégorisation ; totaux de la
  période en tête de liste ; note libre (colonne `notes` existante) ;
  export JSON chiffré par utilisateur (phrase de passe, PBKDF2 + Fernet) ;
  digest e-mail hebdomadaire (SMTP par `YIELDO_SMTP_*`, opt-in par
  utilisateur, envoyé seulement s'il y a quelque chose à dire).

## Défauts du harnais d'aperçu (hors chantier, corrigés au passage)

`goalsPayload` sans `due_on`/`on_track` ; fixture projection avec des mois
13–15. Les payloads du stub sont typés `satisfies` contre `lib/types.ts`
pour que la prochaine dérive soit une erreur de compilation.
