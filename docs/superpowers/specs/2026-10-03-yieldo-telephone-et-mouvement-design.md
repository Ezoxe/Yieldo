# Le téléphone et le mouvement

Deux chantiers liés, dans cet ordre : rendre Yieldo vraiment utilisable sur un
téléphone, puis donner à toute l'application un mouvement « fluide, sympa et
utile ».

Demandes de l'opérateur (3 octobre 2026) :

- « ajuste le site complet pour avoir des animations fluides, sympas et utiles,
  propose-les-moi visuellement avant » ;
- après validation du style et de trois familles d'animations : « termine tout
  et code tout ; juste avant que tu codes la partie animation, fais la
  réorganisation de la partie téléphone pour que l'application soit
  parfaitement utilisable sur un téléphone, car actuellement elle est
  merdique. Fais tout et code tout sans poser de question ».

## Décisions validées sur maquette

- **Style « Fluide »** (choisi parmi Aujourd'hui / Sobre / Fluide / Expressif) :
  300 à 700 ms, la courbe signature `cubic-bezier(0.16, 1, 0.3, 1)`, tout part
  de l'ancienne valeur et va dans le sens du geste, aucun clic n'attend une
  animation.
- **Navigation et chargement** : pas de squelette sous 150 ms ; au-delà, il
  arrive en fondu, tient la place exacte des cartes et le contenu le remplace
  sur place ; l'ancien écran s'efface en 140 ms pendant que le nouveau arrive ;
  le titre est là tout de suite ; entrer dans un budget fait voyager le nom de
  la ligne jusqu'au titre, le contenu arrive par la droite, le retour par la
  gauche ; changer d'environnement fait glisser les entrées ; sur téléphone une
  pastille glisse sous l'onglet actif.
- **Chiffres et graphiques** : pas de recomptage depuis zéro ; un chiffre qui a
  changé depuis le dernier passage roule de l'ancienne valeur à la nouvelle et
  une pastille dit l'écart ; rien n'a changé, rien ne bouge ; barres et jauges
  glissent depuis l'ancienne valeur et changent de couleur au moment où elles
  franchissent 80 % puis 100 % ; les graphiques se dessinent une fois puis se
  transforment ; la courbe d'Avenir se déroule à vitesse constante et ses
  repères apparaissent quand elle les atteint. Mémoire : **option A**, la
  session seulement (rien n'est écrit sur le disque, tout s'efface à la
  déconnexion).
- **Listes** : les lignes qui restent glissent, celles qui partent s'effacent
  vite, celles qui arrivent entrent en courte cascade ; une correction de
  catégorie éclaire la ligne, met à jour sous les yeux les autres lignes que la
  règle a reclassées et ouvre l'avis en douceur ; une ligne masquée sort par la
  droite ; « Charger plus » ajoute sans saut ; les opérations d'un import qui
  vient d'arriver portent « nouveau » trois secondes.

Les familles suivantes n'ont pas eu de maquette ; l'opérateur a demandé de tout
faire sans autre question. Elles suivent le même langage.

## Partie 1 — Le téléphone

### Constat (390 × 844, foyer de démonstration, thème sombre)

- Aucun écran ne déborde en largeur : le travail des audits précédents tient.
- Les écrans sont interminables : Suivi 10 677 px (la section des défis seule
  8 243 px), Catégories 6 180, Vue d'ensemble 6 265, Alertes 5 522, Analyse
  5 369. Sur la Vue d'ensemble, environ 400 px de titre, de lead, de boutons
  pleine largeur et de sélecteur de période passent avant le premier chiffre.
- La barre du haut tient quatre commandes de 32 à 38 px (compte, recherche,
  import, assistant) dont l'assistant fait doublon avec l'onglet du bas.
- « Plus » ouvre la barre latérale de bureau en tiroir gauche, 1 168 px de haut
  pour 21 destinations : il faut la faire défiler pour atteindre Réglages.
- Les cartes gardent leurs marges de bureau (24 px de rembourrage, 16 px
  d'écart) et les en-têtes de panneau un badge de 36 px qui pousse les titres
  sur deux lignes (« Les 30 prochains / jours »).
- Une ligne d'opération occupe 140 px (libellé, puis une liste déroulante de
  catégorie pleine largeur, puis deux boutons) : 39 lignes font 3 474 px.
- Le sélecteur de période tient sur trois lignes (mois, puis cinq préréglages
  qui passent à la ligne).
- Des centaines de cibles font moins de 40 px de haut (Catégories 143, Suivi
  58, Budgets 60) ; des dizaines de champs ont une police sous 16 px, ce qui
  fait zoomer iOS à chaque saisie (Export 87, Mandat 21, Plan 11, Réglages 9).

### Ce qui change

1. **Barre du haut compacte** (≤ 899 px). À gauche, le titre de l'écran apparaît
   en fondu dès que le grand titre de la page est sorti par le haut ; à droite,
   la recherche et le compte, en carrés de 44 px. L'import et l'assistant
   quittent la barre : l'assistant est un onglet, l'import ouvre la feuille
   « Plus ». Le décalage de 62 à 116 px laissé pour l'ancien bouton de menu
   disparaît.
2. **La feuille « Plus »** remplace le tiroir gauche sur téléphone et tablette.
   Elle monte du bas, se ferme d'un glissement vers le bas, d'un appui hors
   d'elle ou avec Échap. En tête : « Finances / Investissement » en contrôle
   segmenté et « Importer un relevé » ; puis toutes les destinations de
   l'environnement en tuiles de 4 colonnes (icône + mot) sous leurs titres de
   section, Réglages compris. Tout tient sans défiler sur un écran de 844 px.
3. **En-tête d'écran** (≤ 639 px) : le titre sans sa marque, le lead coupé à
   deux lignes avec « Lire la suite », les actions de l'écran en une rangée de
   boutons à leur taille (et non plus empilés pleine largeur).
4. **Grille et panneaux** (≤ 767 px) : grille à deux colonnes où chaque carte
   prend toute la largeur sauf déclaration contraire (les tuiles de chiffres en
   prennent une) ; rembourrage 16 px, écart 12 px ; badge de panneau de 28 px ;
   les actions d'un panneau passent sous le titre plutôt que de l'écraser.
5. **Champs** : 16 px de police sous 900 px, partout.
6. **Cibles** : 44 px minimum pour toute commande isolée sur un écran tactile
   (boutons de liste, icônes, liens d'action).
7. **Sélecteur de période** : une seule ligne qui défile horizontalement, mois
   et préréglages ensemble ; « Personnalisé » ouvre les dates dessous.
8. **Tiroirs → feuilles** : sur téléphone, `Drawer` devient une feuille qui monte
   du bas sur presque toute la hauteur, coins supérieurs arrondis, poignée,
   glissement vers le bas pour fermer.
9. **Écrans** :
   - *Vue d'ensemble* : solde, puis les trois chiffres côte à côte, les trente
     prochains jours, ce qui a changé (quatre au plus puis « Voir les N
     autres »), mis de côté, dernières opérations, et les graphiques en dernier,
     plus bas.
   - *Transactions* : une ligne compacte (initiale, libellé, catégorie en petit
     dessous, montant) ; un appui ouvre la feuille de l'opération (catégorie,
     virement interne, modifier) ; recherche et filtres en une rangée.
   - *Budgets* : la liste des budgets d'abord, la répartition ensuite, l'anneau
     en dernier et plus petit.
   - *Catégories* : une ligne par catégorie (pastille, nom, budget) et un bouton
     « ⋯ » de 44 px qui ouvre Modifier / Supprimer.
   - *Suivi* : trois défis puis « Voir les N autres ».
   - *Avenir* : les deux chiffres côte à côte, le graphique juste dessous.
   - *Alertes*, *Analyse*, *Réglages* et les autres : ils héritent des règles
     communes ; ce qui reste trop long après la passe commune est replié de la
     même façon (« Voir les N autres »).

Critère : sur un téléphone de 390 px, dans les deux thèmes, aucun écran ne
défile en largeur, aucune commande isolée ne fait moins de 44 px, aucun champ ne
fait zoomer, et la Vue d'ensemble, les Transactions, les Budgets et Avenir
montrent leur premier chiffre dans le premier écran.

## Partie 2 — Le mouvement « Fluide »

### Le langage

| | durée | courbe |
|---|---|---|
| retour au toucher (survol, appui) | 120–160 ms | sortie rapide |
| changement d'interface (onglet, menu, fenêtre) | 200–300 ms | signature |
| arrivée de contenu | 260–380 ms | signature |
| chiffres, barres, graphiques | 500–760 ms | signature / quart |
| déroulé d'Avenir | 900 ms | linéaire (le temps qui passe) |

- Une sortie dure environ 60 % de l'entrée ; un élément qui suit le doigt
  (pastilles, interrupteurs, feuilles) est un ressort sans rebond.
- Distances courtes (6 à 18 px), dans le sens du geste ; cascade de 25 à 45 ms,
  plafonnée à huit éléments.
- On n'anime que `transform`, `opacity` et `clip-path` sur les grandes
  surfaces.
- Tout s'arrête sous `prefers-reduced-motion` et sous l'interrupteur
  « Animations » des Réglages (`:root[data-motion="off"]`,
  `useReducedMotion()`), sans animation à zéro milliseconde qui laisserait un
  élément invisible.

### 1. Navigation et chargement (validé)

- L'ancien écran s'efface en 140 ms pendant que le nouveau arrive (fondu et
  6 px), sans rien attendre. Entrer plus profond (`/budgets` → `/budgets/:id`,
  `/reglages` → `/reglages/connexions`, `/invest` → ses pages) fait arriver par
  la droite, remonter par la gauche.
- Le nom d'un budget voyage de sa ligne jusqu'au titre de son univers
  (`layoutId` partagé).
- Squelettes : rien avant 150 ms ; ensuite un fondu ; à l'arrivée des données
  le squelette s'efface sur place pendant que le contenu apparaît.
- Barre latérale : la pastille glisse déjà ; les entrées glissent au changement
  d'environnement. Téléphone : pastille sous l'onglet actif ; le titre compact
  de la barre du haut apparaît et disparaît en fondu.

### 2. Chiffres et graphiques (validé, option A)

- Une mémoire de session retient la dernière valeur affichée de chaque chiffre
  nommé ; elle est vidée à la déconnexion.
- Premier affichage : le chiffre s'affiche. Ensuite, s'il a changé, il roule
  (640 ms) depuis la valeur retenue et une pastille dit « +212,25 € depuis ton
  dernier passage » ; s'il n'a pas changé, rien ne bouge.
- Barres et jauges (budgets, objectifs, dettes, univers) : depuis la valeur
  retenue (zéro au premier affichage), couleur basculée au franchissement de
  80 % et 100 %.
- Graphiques ECharts : premier tracé de la session dessiné, ensuite
  transformation depuis les données retenues, rien si rien n'a changé ; barres
  en cascade. Avenir : déroulé linéaire, repères (événements, point bas) qui
  apparaissent quand la courbe les atteint.

### 3. Listes (validé)

- Transactions : lignes en `layout` + présence (recherche, filtres, « Charger
  plus », virement masqué qui sort par la droite) ; une correction éclaire la
  catégorie, recharge la page en silence quand la règle a reclassé d'autres
  opérations et éclaire celles qui ont changé ; l'avis s'ouvre en hauteur.
- Arrivée depuis un import : « nouveau » et un trait d'accent trois secondes sur
  les opérations de ce lot.
- Mêmes entrées/sorties pour les autres listes où l'on ajoute ou retire :
  propositions, alertes, récurrences déclarées, événements prévus, objectifs,
  dettes, catégories.

### 4. Fenêtres, menus, feuilles, sections dépliables

- Recherche globale : la fenêtre s'ouvre depuis le champ (fondu, 2 % d'échelle,
  origine en haut), ses groupes arrivent en cascade ; fermeture en 140 ms.
- Menus (compte, environnement) et bulles d'aide : fondu et 3 % d'échelle depuis
  leur bouton, 160 ms ; sortie 100 ms.
- Feuilles (Plus, opération, tiroirs sur téléphone) : montée en ressort, sortie
  vers le bas, glissement vers le bas pour fermer.
- Sections dépliables (`<details>`) : la hauteur s'ouvre et se ferme (240 ms),
  le chevron tourne.

### 5. Retours d'action

- Appui : les boutons s'enfoncent à 97 % (80 ms).
- Enregistrement : le bouton passe à « Enregistré » avec une coche qui se dessine,
  puis revient.
- Erreur : le message arrive en fondu et 4 px ; le champ fautif tremble deux fois
  de 3 px.
- Interrupteurs : le curseur glisse en ressort.

### 6. Moments marquants

- Changement de thème : le nouveau thème s'ouvre en cercle depuis le bouton qui
  l'a demandé (View Transitions ; sinon instantané).
- Import terminé : les chiffres du bilan roulent ; « Voir les opérations »
  mène aux opérations éclairées « nouveau ».
- Objectif atteint : l'anneau se ferme, passe au vert, la coche se dessine.
- Budgets → univers : le nom voyage jusqu'au titre (ci-dessus).
- Avenir : le déroulé (ci-dessus). Le shibi ne change pas : il reste la
  rediffusion de `answer.steps`.

## Vérification

- Tests : chaque primitive nouvelle a son test (mémoire de session, chiffre
  animé, squelette différé, feuille, direction de navigation, politique
  d'animation des graphiques) ; les tests existants suivent le nouveau balisage.
- Navigateur : 390 et 1440 px, thèmes clair et sombre, animations actives et
  coupées, sur le foyer de démonstration.
