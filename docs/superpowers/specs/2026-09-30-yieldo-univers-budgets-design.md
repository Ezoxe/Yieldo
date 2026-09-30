# Les univers des budgets

Un budget ouvert devient une page à lui : une scène qui représente ce que la
catégorie EST (une voiture pour Transport, une maison pour Logement…), animée
par les vrais chiffres, et sous la scène ce que la catégorie a coûté ce mois-ci
et en moyenne au fil des années.

Demande de l'opérateur (30 septembre 2026) : « quand je sélectionne le budget
carburant ou voiture, une page s'ouvre avec une voiture, le carburant en
dynamique qui bouge, les mécaniques de la voiture, et je vois ce que cela m'a
coûté au mois, et en moyenne durant ces années ». Même chose pour le téléphone,
le streaming, etc. : un maximum d'univers.

## Décisions validées

- **Un univers par famille.** La voiture est la famille Transport ; ses
  sous-catégories sont ses pièces. Ouvrir « Carburant » montre la même
  voiture, la pièce du carburant en avant, les autres atténuées.
- **Style : réaliste, opaque, avec des loupes rayons X.** La voiture est une
  GT blanche dessinée d'après une photo de référence de 911 GT3 (proportions,
  jantes dorées à écrou central, étriers jaunes, aileron col de cygne), sans
  badge ni écusson. Seules les pièces pointées sont vues « aux rayons X », dans
  des loupes rondes posées là où la pièce se trouve vraiment :
  - **Carburant** : le réservoir, derrière la roue avant, avec son goulot vers
    la trappe ronde de l'aile et le carburant qui file vers le moteur ;
  - **Entretien véhicule** : le flat-six derrière l'essieu arrière, pistons et
    poulie en mouvement ;
  - **Assurance véhicule** : l'arceau, vu par la vitre de custode ;
  - **Péage et stationnement** : le badge de télépéage derrière le rétroviseur
    intérieur, qui s'allume quand un portique passe.
- **Livraison par étapes.** Le socle et la voiture d'abord, jugés dans le
  navigateur ; puis un univers après l'autre, chacun validé en maquette avant
  d'être codé. Branche `feat/budget-universes`, un commit par tâche, rien de
  poussé avant que l'opérateur ait validé tous les univers.

## Parcours

- Un clic sur une catégorie de l'écran Budgets — le nom d'une barre de budget,
  une ligne de « Où va l'argent », une ligne de « Sans budget » — ouvre
  `/budgets/:id?mois=AAAA-MM`, le mois affiché sur Budgets.
- La page garde la navigation de mois de Budgets (flèches, `?mois=`) et un
  retour vers Budgets.
- Sur la scène, une loupe est un bouton : elle ouvre la page de la
  sous-catégorie qu'elle montre.

## La page

1. **En-tête** (`PageHead`) : le nom de la catégorie ; la phrase d'accroche
   donne tout de suite les deux chiffres demandés — « 262,00 € en septembre
   2026 · 287,00 € par mois en moyenne depuis mars 2025 » ; les flèches de mois.
2. **La scène**, pleine largeur, quand la catégorie a un univers.
3. **Quatre panneaux** :
   - « Ce mois » : dépensé, budget, reste, statut (les mêmes figures et le même
     moteur que l'écran Budgets), nombre d'opérations et montant moyen ;
   - « En moyenne » : la moyenne mensuelle sur l'historique, et année par
     année (total, nombre de mois comptés, moyenne mensuelle) ;
   - « Mois par mois » : une barre par mois sur tout l'historique, le mois
     affiché mis en évidence, la moyenne en ligne horizontale ;
   - « Postes » : chaque sous-catégorie — ce mois, moyenne, nombre
     d'opérations, montant moyen (« 2 opérations, 59,00 € en moyenne »).
     Les sous-catégories qui n'ont pas de pièce dans la scène (Transports en
     commun, Billets et voyages) y figurent comme les autres : le total de la
     page reste celui de la famille entière.

Une catégorie sans univers garde la page, sans scène : les chiffres d'abord,
la scène le jour où son univers existe.

## Règles des chiffres

- **Dépense** : la même que l'écran Budgets — les sorties de la catégorie et
  de toutes ses descendantes, virements internes exclus, sous le mode de
  lecture choisi (`tx_points`). Montants en centimes entiers, négatifs pour
  une sortie.
- **Mois complet** : un mois entièrement couvert par les relevés du foyer
  (du premier au dernier jour, d'après l'étendue de l'historique). Le mois en
  cours n'est pas complet ; un premier mois importé à partir du 12 non plus.
- **Moyenne mensuelle** : le total des mois complets divisé par leur nombre,
  arrondi au centime. Un mois complet sans dépense compte pour 0 (ne rien
  dépenser est une réponse). Moins de trois mois complets : pas de moyenne,
  et la page le dit (« Moins de trois mois complets de relevés »). La moyenne
  ne dépend pas du mois affiché.
- **Année par année** : la même règle, restreinte aux mois complets de chaque
  année civile ; le nombre de mois comptés est affiché.
- **Cadran de la scène** : le budget de la catégorie de la page (reste X € sur
  Y €, statut). Sans budget, pas de cadran.
- **Niveau d'une pièce** (le réservoir) : si la sous-catégorie a un budget,
  la part qui en reste ; sinon, la part de sa moyenne mensuelle qui n'est pas
  encore dépensée ce mois-ci, écrite comme telle (« 118 € ce mois, moyenne
  104 € ») ; sans moyenne, pas de niveau (le réservoir est dessiné vide de
  liquide, sans voyant).
- **Couleur d'état** d'une pièce : celle de son propre budget (dans le budget,
  en passe de dépasser, dépassé) ; sans budget, neutre.

## Animations

- À l'ouverture : le réservoir se vide jusqu'à son vrai niveau, l'aiguille du
  cadran descend jusqu'au reste. Ce sont les seuls mouvements qui portent un
  chiffre, et ils s'arrêtent sur la valeur vraie.
- Décor en boucle : roues, route, pistons, poulie, badge au passage d'un
  portique, balayage des loupes. Aucun ne représente une donnée.
- Tout s'arrête (état final affiché) sous « réduire les animations » du
  système ou l'interrupteur de Réglages (`data-motion="off"`).

## Univers ↔ catégories

Un registre pur côté client (`features/budgets/universe/registry.ts`) :

1. par slug des catégories par défaut — `transport` → voiture ;
   `transport-carburant` → réservoir, `transport-entretien` → moteur,
   `transport-assurance` → arceau, `transport-peage` → badge ;
2. à défaut, par mots du nom, pour les catégories créées par le foyer —
   voiture, auto, véhicule ; carburant, essence, gazole, plein ; entretien,
   garage, révision, pneu ; assurance ; péage, parking, stationnement,
   autoroute ;
3. une sous-catégorie prend l'univers de sa famille ; une catégorie racine
   reconnue comme une pièce (« Essence » créée seule) prend l'univers de la
   pièce, cette pièce en avant.

## Clair, sombre, téléphone

- La scène est posée sur un « studio » qui suit le thème ; ses couleurs sont
  des variables CSS de la feuille de la scène (couleurs physiques : peinture,
  pneu, or des jantes), jamais un hexadécimal dans un composant. En clair, la
  voiture blanche reçoit un liseré et une ombre plus marqués. Les loupes restent
  sombres dans les deux thèmes : ce sont des écrans.
- Les étiquettes des pièces sont du HTML aux couleurs du thème : posées sur la
  scène en grand écran, en liste sous la scène sous 640 px, où le dessin est
  trop petit pour porter du texte. Les loupes restent cliquables partout.

## API

`GET /budgets/{category_id}/detail?month=AAAA-MM` — le mois est résolu comme
sur `/budgets` (absent : le mois de la dernière opération). Une catégorie d'un
autre foyer ou inexistante : 404 en français.

```
category    { id, name, slug, color, is_essential, parent: {id, name, slug} | null }
month, month_start, month_end, days_elapsed, days_in_month, is_current_month
spent_cents, count, average_ticket_cents | null
budget      { budget_cents, remaining_cents, consumed_ratio, projected_cents,
              status } | null
average_cents | null, months_counted
years       [ { year, spent_cents, months_counted, monthly_average_cents | null } ]
series      [ { month, spent_cents, count, complete } ]   # tout l'historique
parts       [ Part ]   # les enfants directs de la catégorie
siblings    [ Part ]   # les enfants directs du parent (elle comprise), si elle en a un
history     HistoryOut | null

Part = { category_id, name, slug, color, spent_cents, count,
         average_ticket_cents | null, average_cents | null, months_counted,
         budget | null }
```

Moteur pur `engines/category_history.py` (séries mensuelles d'un sous-arbre,
mois complets, moyennes, années) ; la route lit l'horloge, la base, le mode de
lecture, et réutilise `engines/budget.evaluate_budgets` pour les budgets.

## Frontend

- `features/budgets/universe/` : `UniversePage.tsx` (route `/budgets/:id`),
  `registry.ts`, `readings.ts` (niveau, cadran, états — pur), les panneaux,
  `scenes/car/CarScene.tsx` + `CarScene.css`.
- Liens depuis `BudgetsPage` et `BudgetBar`.
- Le stub `?apercu=1` simule la nouvelle route.
- Le foyer de démonstration (`e2e/seed_demo_household.py`) reçoit de vraies
  dépenses de voiture (assurance auto, péages, entretien) et un budget
  Transport, pour juger la page sur des données réelles.

## Tests

- Moteur : mois complets, zéro compté, moins de trois mois, années partielles,
  arrondi, sous-arbre (cycle compris).
- Route : isolation (404 sur la catégorie d'un autre foyer), cumul des
  enfants, `parts` et `siblings`, budget, mois invalide, mois par défaut.
- Registre et lectures : slugs, mots, repli, niveaux avec et sans budget ou
  moyenne.
- Page et scène : chiffres nommés, loupes accessibles (nom + montant),
  liens, catégorie sans univers, erreur de chargement dite en français.
- Jugement à l'œil : 1440 et 390 px, clair et sombre, sur le foyer de
  démonstration, animations coupées et actives.

## Les univers suivants

Chacun sera dessiné en maquette, validé, puis codé sur le même contrat
(scène + registre) : Logement (maison), Internet et téléphone, Abonnements
(streaming), Alimentation, Santé, Loisirs, Achats, Famille, Impôts, Frais
bancaires. Leur forme exacte est décidée univers par univers.
