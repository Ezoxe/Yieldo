# Recherche unifiée — une barre par écran, une barre pour tout

Date : 2026-09-09

## Le problème

L'écran Transactions porte deux champs de saisie côte à côte : « Rechercher un
libellé… » et le combobox « Toutes les catégories ». Deux barres qui se
ressemblent et qui ne cherchent pas la même chose, c'est au lecteur de deviner
laquelle interroger. Et celle qui dit « rechercher » ne cherche que le libellé
normalisé : `normalize_label` retire les chiffres et les accents, donc taper
« 12,50 » ou « CB 12/03 » ne trouve rien.

Le header, lui, porte le mode de lecture — un choix pris rarement, occupant en
permanence la bande la plus précieuse de la page — et rien pour atteindre une
donnée qu'on ne sait pas où chercher.

## Ce qu'on construit

### 1. Transactions : une seule barre

Le combobox catégorie quitte `FilterBar`. Restent le sélecteur de période, la
barre unique, le select de compte et les deux interrupteurs — un select et deux
switches ne sont pas des barres de recherche.

Le paramètre `search` de `GET /transactions` devient un OU sur :

- **libellé** — `label_clean` contient `normalize_label(q)` (comportement
  actuel) **ou** `label_raw` contient `q`, insensible à la casse. Les deux,
  parce que le premier trouve « carrefour » dans « CARREFOUR MARKET 12/03 » et
  le second trouve « 12/03 » que le premier a effacé ;
- **montant** — si `q` s'analyse en nombre (`12`, `12,50`, `-45.90`,
  `12.50 €`), alors `abs(amount_cents)` égale les centimes analysés. `12` seul
  vaut 12,00 € ;
- **catégorie** — nom de la catégorie de la ligne contenant `q` ;
- **compte** — nom du compte de la ligne contenant `q` ;
- **date** — si `q` s'analyse en date (`2026-03-12` ou `12/03/2026`),
  `Transaction.date` égale cette date.

L'analyse de la saisie est pure : `backend/app/engines/search.py` expose
`parse_query(raw) -> QueryTerms(text, amount_cents, on_date)`, sans session ni
horloge. La route assemble le `or_(...)` SQL à partir de ce résultat.

`category_id` reste un paramètre de l'API — d'autres appelants s'en servent —
seul le contrôle disparaît de l'écran. `activeFilterLabels` perd sa ligne
catégorie.

### 2. La super-recherche du header

Un bouton prend la place du mode de lecture : « Rechercher » et le raccourci
`⌘K` / `Ctrl+K`. Sous 900px, l'icône seule ; le nom accessible est inchangé,
rien n'est jamais nommé par un dessin seul.

Il ouvre un dialogue — Escape le ferme, le focus y est piégé, il revient au
bouton en sortant — avec un champ et des résultats groupés :

- **Écrans** — `NAV_SECTIONS` filtré côté client. Aucune requête : taper
  « Import » mène à `/import` sans réseau.
- **Données** — `GET /search?q=&limit=` en lecture seule, chaque requête
  filtrée sur `user_id` via `get_current_user`. Groupes : transactions,
  comptes, catégories, objectifs, dettes, récurrences déclarées. Cinq
  résultats par groupe, chacun portant son libellé, un détail et sa route.
  Debounce 250 ms, requête précédente annulée par `AbortController`.

Aucun résultat : une phrase nommant ce qui a été cherché. Erreur réseau : le
message est affiché et les écrans restent listés, puisqu'ils sont locaux —
jamais un vide muet.

### 3. Le mode de lecture s'en va aux Réglages

`LedgerModeControl` entre dans `SettingsPage`, panneau « Lecture des chiffres »
placé avant Apparence. `AppShell` garde `useLedgerMode` : l'`Outlet` reste keyed
sur le mode, changer de lecture refait toujours l'écran.

Le header garde une pastille — et seulement quand le mode n'est pas « Réel ».
Elle nomme la lecture en cours (« Estimation », « Mélangé »), prend le ton
`info`, et mène aux Réglages. En « Réel » elle n'existe pas. Un chiffre estimé
sous un libellé muet serait un mensonge dans la bonne police ; une pastille
permanente disant « Réel » serait du bruit onze mois sur douze.

## Tests

TDD, test en échec d'abord.

- `backend/tests/test_search_engine.py` — `parse_query` sur les montants
  (`12`, `12,50`, `-45.90`, `12.50 €`, `abc`), les dates (ISO, `JJ/MM/AAAA`,
  invalide), et le texte conservé dans tous les cas.
- `backend/tests/test_transactions.py` — recherche par montant, par nom de
  catégorie, par nom de compte, par date, et par fragment que `label_clean`
  avait effacé.
- `backend/tests/test_search_api.py` — chaque groupe, l'isolation (les données
  d'un autre compte n'apparaissent jamais), la limite par groupe, et `q` vide
  qui renvoie des groupes vides sans toucher la base.
- `frontend/src/features/transactions/FilterBar.test.tsx` — un seul champ de
  saisie dans la barre, et le combobox catégorie absent.
- `frontend/src/design/search/GlobalSearch.test.tsx` — ouverture au raccourci,
  fermeture à Escape, les écrans trouvés sans réseau, les données trouvées
  après debounce, le vide nommé, l'erreur affichée.
- `frontend/src/app/AppShell.test.tsx` — le mode de lecture n'est plus dans le
  header, la pastille apparaît hors « Réel » et pas en « Réel », le bouton de
  recherche est là.
- `frontend/src/features/settings/SettingsPage.test.tsx` — le panneau « Lecture
  des chiffres » et son radiogroup.
