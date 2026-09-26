# Audit du 26 septembre 2026 : sécurité, qualité, et « Avenir »

Ce que l'audit du code (backend, frontend, dépendances, écrans en 1440 px et
390 px) a trouvé, ce que l'opérateur a retenu, et la forme que prend chaque
chantier. Quatre chantiers, exécutés dans l'ordre **S → Q → AV → U**.

État mesuré avant toute modification :

- backend : 2 304 tests verts, 6 ignorés, couverture 95 % (`app/engines` et
  `app/importers` entre 82 % et 99 %) ;
- frontend : 1 620 tests verts, `npm run build` vert (chunk initial
  173 kB gzip, chunk echarts 343 kB gzip) ;
- `ruff check` : 17 erreurs ; `npm run lint` : cassé depuis l'échafaudage,
  ESLint n'a jamais été installé ;
- `npm audit` : echarts < 6.1 (XSS, part en production), vite ≤ 6.4.2 et
  vitest ≤ 4.1.10 (serveur de développement seulement).

Décisions de l'opérateur : les quatre lots ; l'approche « Avenir complet » ;
Trésorerie devient « Avenir » ; inscriptions fermées par défaut après le
premier compte. Choix par défaut retenus pour le design (modifiables à la
relecture) : périmètre « Comptes courants » à l'ouverture ; scénarios « Et
si… » jamais enregistrés, sauf conversion explicite d'un scénario ponctuel en
événement prévu ; déclarations exclues du rejeu de fiabilité.

Règles communes : une tâche = un commit (Conventional Commits, anglais) ; le
test rouge d'abord ; montants en centimes entiers ; moteurs purs (pas de
session, pas de réseau, pas d'horloge implicite) ; toute requête filtrée sur
`user_id` ; chaque phrase visible en français, avec sa typographie ; les
écrans sont jugés dans un navigateur, en 1440 et en 390, thèmes clair et
sombre, avant d'être déclarés finis.

## S — Sécurité

| # | Défaut mesuré | Correction | Preuve |
|---|---|---|---|
| S1 | **XSS stocké.** Les infobulles ECharts sont du HTML (`innerHTML`), et `CategoryTreemap`, `SpendingDonut`, `AnswerChart`, `WaterfallChart`, `SessionCharts` (et tout formatter qui interpole un nom) y insèrent des chaînes venues des données : nom de catégorie, libellé, symbole. Une clé agent `yld_…` peut créer une catégorie `<img src=x onerror=…>` ; le code s'exécute dans la session du propriétaire, ce qui annule la règle « une clé ouvre le grand livre, pas le compte ». | `charts/escapeHtml.ts` (`& < > " '`), appliqué à toute chaîne d'origine donnée dans un formatter d'infobulle. Revue de chaque `formatter` de `src/charts` et `src/features`. | `escapeHtml.test.ts` ; un test par graphique concerné appelle le formatter avec `<img src=x onerror=alert(1)>` et exige `&lt;img`. |
| S2 | Aucune limite de tentatives sur `POST /auth/login` : Argon2 à ~50 ms laisse deviner un mot de passe. | `security/throttle.py`, en mémoire (un seul processus uvicorn) avec horloge injectable : 5 échecs par couple (IP, email) sur 15 min, 50 échecs par IP sur 15 min ; au-delà, **429** « Trop de tentatives de connexion. Réessayez dans N minutes. » et `Retry-After`. Un succès efface le compteur du couple. | `test_login_throttle.py` (seuils, fenêtre glissante, remise à zéro, message). |
| S3 | Changer de mot de passe laisse vivre toutes les sessions : un cookie de rafraîchissement volé reste valable 30 jours. | Colonne `users.session_version` (entier, défaut 0, migration). Les JWT portent `sv` ; un jeton sans `sv` vaut 0. `get_current_user`, `get_session_user` et `/auth/refresh` refusent un `sv` différent. `POST /auth/password` incrémente la version, supprime la clé agent, et **renvoie la nouvelle session** (`TokenOut` + cookie) pour que l'onglet courant reste connecté. Nouveau `POST /auth/sessions/revoke-others` (session seulement) : même effet, bouton « Déconnecter les autres appareils » dans Réglages → Compte. | `test_session_revocation.py` ; test front du bouton et de l'application de la session renvoyée. |
| S4 | Aucun en-tête de sécurité : ni CSP, ni protection contre l'intégration dans une page tierce (clickjacking). | `security/headers.py`, middleware : sur toute réponse `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Sur les réponses de l'interface (hors `/api`) : `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. `/api/docs` n'a pas de CSP (Swagger charge son CDN). | `test_security_headers.py` ; build servi par le backend, chaque écran ouvert dans le navigateur : zéro violation CSP dans la console. |
| S5 | L'email se change sans le mot de passe actuel : une session volée suffit à détourner le compte. | `ProfileIn.current_password` ; exigé et vérifié quand l'email change (422 « Confirmez votre mot de passe actuel pour changer d'email », 403 s'il est faux). Le nom seul n'en demande pas. Champ ajouté au formulaire de Réglages. | tests API et composant. |
| S6 | **Fuite entre foyers.** `PATCH /goals/{id}` avec `saved_cents` et l'`account_id` d'un autre foyer lit ce compte sans filtre `user_id` et renvoie son **nom** dans l'erreur (`api/goals.py`, lecture de `backed_after`). | La propriété du compte est vérifiée avant toute lecture de son nom (404 « Compte introuvable »). | test : l'utilisateur B vise le compte de A, reçoit 404, le nom de A n'apparaît nulle part. |
| S7 | Export CSV : un libellé, une note, un nom de catégorie ou de compte commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot est exécuté comme formule par un tableur. | `_csv_safe` préfixe ces cellules texte d'une apostrophe ; la date et le montant ne sont pas touchés. | test d'export. |
| S8 | Cookie de rafraîchissement jamais `Secure`, même derrière HTTPS. Hors Docker, l'application démarre avec la clé par défaut (26 octets, PyJWT l'avertit à chaque test). | `secure` vaut vrai quand la requête arrive en HTTPS (`request.url.scheme`, alimenté par les en-têtes du proxy qu'uvicorn croit : `FORWARDED_ALLOW_IPS`, exposé dans `docker-compose.yml` sous `YIELDO_TRUSTED_PROXIES`, 127.0.0.1 par défaut, documenté dans le README). Au démarrage, **si l'interface est servie** (`YIELDO_STATIC_DIR` existe) et que la clé est celle par défaut ou fait moins de 32 caractères : arrêt avec « Clé secrète absente ou trop courte : lancez ./install.sh install. » ; en développement, un avertissement journalisé seulement. | tests du cookie (http/https) et du garde-fou de démarrage. |
| S9 | Import : un `dialect` ou un `mapping` illisible (JSON cassé, clé inconnue) lève une 500. | 422 « Le paramétrage de l'import est illisible : relancez l'analyse. » | tests API. |
| S10 | Inscriptions ouvertes par défaut : tout visiteur du réseau crée un compte, et peut se servir des connexions configurables (modèle, Laya) comme d'un relais vers le réseau local. | `registration_open` vaut **faux** par défaut (config, `docker-compose.yml`, `install.sh`) ; le premier compte reste toujours possible. Table `instance_settings` (une ligne) : `registration_open` nullable, `NULL` = suivre l'environnement. `GET /auth/registration` (public) → `{open, first_account}` ; `GET`/`PATCH /admin/settings` (session + rôle admin). Réglages → Compte, admin seulement : « Autoriser la création d'autres comptes sur cette installation ». L'écran d'inscription fermé le dit : « Les inscriptions sont fermées : demandez à l'administrateur de cette installation de les ouvrir. » | tests API, migration, composants. |

## Q — Qualité et dépendances

| # | Changement | Preuve |
|---|---|---|
| Q1 | ESLint 9 réellement installé : `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` ; `eslint.config.js` plat (recommandés JS, TS non typés, hooks : `rules-of-hooks` en erreur, `exhaustive-deps` en avertissement) ; `dist/` et `coverage/` ignorés. Chaque trouvaille est corrigée ; une désactivation locale n'est admise qu'avec sa raison écrite à côté. | `npm run lint` à zéro avertissement. |
| Q2 | Les 17 erreurs ruff corrigées (imports triés, lignes > 100, `zip(strict=…)`, conditions « Yoda »). | `ruff check app tests` vert. |
| Q3 | Avertissements des tests : une clé de test de 64 caractères posée par une fixture `autouse` de `conftest.py` ; la dépréciation du `TestClient` de Starlette traitée à la source si la dépendance recommandée s'installe proprement, sinon filtrée nommément dans `pyproject.toml` avec sa raison ; les avertissements `act(...)` du frontend corrigés dans les tests qui les émettent. | sorties de test sans ces avertissements. |
| Q4 | echarts 6 et imports modulaires : un seul module `charts/echarts.ts` enregistre `echarts/core`, les séries et composants réellement utilisés et le rendu canvas ; chaque graphique l'importe. | taille du chunk mesurée avant/après ; chaque écran à graphique ouvert en 1440 et 390, deux thèmes. |
| Q5 | vite, vitest, `@vitejs/plugin-react`, jsdom, `@tailwindcss/vite` montés aux versions qui ferment les avis de sécurité. | `npm audit` sans vulnérabilité connue ; tests, build et serveur de dev verts. |

## AV — Avenir

### Ce que l'écran doit dire

Une seule question : **« que va devenir mon argent, jour après jour, et
pourquoi ? »** Trois réponses d'abord, la méthode ensuite :

- le solde prévu à la fin du mois (fourchette basse / médiane / haute) ;
- le **point bas** : date, montant, et un niveau de risque de découvert ;
- la **fiabilité mesurée** : ce que cette même méthode a donné sur l'historique
  du foyer.

Aujourd'hui trois sources de futur ne se parlent pas — récurrences détectées
(Trésorerie), récurrences déclarées (Récurrences), lignes du Plan — et la
prévision sur 12 mois ignore les deux dernières. Elle est mensuelle et ne peut
pas répondre à « serai-je à découvert avant la paie ? ». Avenir remplace
Trésorerie et répare cela.

### Deux défauts de la prévision actuelle, corrigés au passage

Ils touchent `/cashflow/forecast` et l'alerte de seuil, et sont corrigés dans
le chemin partagé avant d'écrire le nouveau moteur :

1. **Épargne investie ignorée.** Un virement mensuel du compte courant vers un
   PEA, une assurance-vie, un PER, un compte-titres ou un portefeuille crypto
   est marqué `is_transfer` ; `recurrence_points` l'exclut, il disparaît donc
   des flux projetés alors qu'il quitte bien le périmètre disponible. La
   prévision est trop optimiste de ce montant chaque mois.
2. **Libellé écarté = dépense effacée.** « Ce n'est pas un abonnement » retire
   le libellé de `recurrence_points`, donc aussi de la part variable : les
   courses écartées de la détection ne comptent plus du tout dans l'avenir.

Correction : un assembleur partagé `common.scope_flows(db, user_id, scope)`
fournit les flux du périmètre (voir plus bas) ; la détection lit ces flux
moins les libellés écartés ; la part variable lit **tous** les flux du
périmètre. Tests de non-régression dans `test_cashflow_api.py` et
`test_alerts_api.py`.

### Le périmètre

- **Comptes courants** (`checking`, non archivés) — la question du découvert,
  ouverte par défaut ;
- **Tout le disponible** (`checking`, `savings`, `cash`, comme l'actuel
  « Solde disponible »).

Les flux d'un périmètre sont **toutes** les opérations de ses comptes, sauf les
virements internes au périmètre. Un virement est interne quand une opération
de signe opposé et de même valeur absolue existe sur un **autre** compte du
même périmètre à ±3 jours (appariement glouton par date, chaque ligne servant
une fois). Ainsi le virement courant → livret disparaît de « Tout le
disponible » mais reste une sortie de « Comptes courants » ; le virement
courant → PEA reste une sortie des deux. Le solde de départ est la somme des
soldes (ouverture + mouvements) des comptes du périmètre.

Une déclaration ou un événement prévu sans compte est rattaché à tous les
périmètres ; avec un compte, aux seuls périmètres qui le contiennent.

### Un euro, une seule source

Le moteur additionne trois sortes de montants futurs, et chaque euro de
l'historique n'en nourrit qu'une :

1. **Récurrences détectées** (`engines/recurrence`), projetées à leurs dates.
2. **Déclarations** : récurrences déclarées (montant observé sur les pointages
   quand `engines/schedule.observed_amount` le permet) et **événements
   prévus** (nouveaux, ponctuels : impôts, vacances, prime).
3. **Part variable** : tout le reste de l'historique, mesuré en médiane avec sa
   fourchette (le modèle de `engines/forecast`).

Règles de rapprochement, dans cet ordre (`engines/outlook_sources.py`, pur) :

- **Déclaration ↔ détection.** Une récurrence déclarée active remplace la
  récurrence détectée qui lui correspond : même libellé normalisé, ou bien même
  signe, même rythme, montant à ±15 % du montant déclaré et prochaine échéance
  à ±5 jours. Au plus une détection par déclaration (la plus proche en
  montant). La détection remplacée n'est plus projetée ; ses lignes restent
  retirées de la part variable, comme aujourd'hui.
- **Déclaration ↔ lignes du relevé.** Les lignes pointées sur la déclaration
  (`RecurrenceCheckin.transaction_id`) et celles dont le libellé normalisé la
  rejoint (sous-chaîne dans un sens ou dans l'autre, clé d'au moins 4
  caractères, entre `anchor_on` et la fin du relevé — la règle de
  `engines/plan`) quittent la part variable.
- **Déclaration non reliée.** Une déclaration commencée avant la fin du relevé,
  sans détection rapprochée ni ligne reliée, reste projetée mais porte un
  avertissement : « Aucune ligne de vos relevés ne correspond à « Eau » : si ce
  prélèvement figure déjà dans vos dépenses, il est compté deux fois. Donnez-lui
  le libellé du relevé. »
- **Les lignes du Plan** (`plan_lines`) ne sont pas lues : elles servent les
  lectures « Estimé » et « Réel complété » des mois sans relevé. Le Plan le
  dit et renvoie vers Avenir (chantier U).

### Les moteurs

Tous purs, chacun avec son fichier de tests.

**`engines/forecast.py` — découpe sans changement de résultat.** Le calcul de
la part variable (centre saisonnier ou global, les deux échelles, la variance
cumulée qui croît en *k* pour le bruit et en *k²* pour l'erreur de centre) est
extrait dans une fonction publique qui rend, pour une suite de mois, le centre
de chaque mois, son drapeau saisonnier et la variance cumulée en fin de mois.
`project_cashflow` l'utilise ; ses tests existants restent verts et servent de
garde-fou.

**`engines/outlook_sources.py`.** Appariement des virements internes, flux du
périmètre, détection, rapprochements, part variable, et expansion des
événements connus sur l'horizon :

- récurrence détectée mensuelle, trimestrielle, annuelle : pas en mois civils à
  partir du mois de `expected_next_on`, au jour de `last_on`, borné à la
  longueur du mois ; hebdomadaire et bimensuelle : pas en jours depuis
  `expected_next_on` ;
- récurrence déclarée : `schedule.due_dates` ;
- événement prévu : sa date, s'il tombe dans l'horizon.

Chaque événement : date, montant signé, libellé, source (`detected`,
`declared`, `planned`, `scenario`), référence de sa série, catégorie.
Les occurrences antérieures ou égales à la fin du relevé ne sont pas
projetées : une échéance en retard appartient au présent, pas à l'avenir.

**`engines/outlook.py`.** La projection au jour, de la fin du relevé
(`as_of`) jusqu'à l'horizon (1 à 730 jours ; 90 par défaut, 365 pour la vue
12 mois) :

- **médiane** du jour *d* = solde de départ + événements ≤ *d* + part
  variable accumulée ;
- la part variable d'un mois est son centre, réparti selon le **profil du
  foyer dans le mois** : pour chaque mois observé, la part cumulée des sorties
  variables par jour du mois ramené à la longueur du mois ; médiane par jour ;
  rendue croissante de 0 à 1. Moins de 6 mois observés : profil uniforme, et
  l'écran le dit ;
- le mois en cours n'est projeté que pour sa fraction restante (1 − profil du
  jour de `as_of`) ;
- **fourchette** : la variance cumulée de fin de mois du modèle de
  `forecast`, interpolée dans le mois par le même profil ; bornes à
  ± `quantile_offset_cents(√variance, P90_SIGMAS)`, donc une fourchette 80 %
  qui s'élargit avec la distance ;
- sans part variable mesurable, les mêmes deux cas que `forecast`
  (« charges connues seulement », « aucune dispersion ») : une ligne sans
  fourchette, et la phrase qui dit pourquoi ;
- **sorties** : les jours (basse, médiane, haute) ; les événements avec le
  solde médian juste après chacun ; par mois, la fin de mois et le point bas
  du mois ; le **point bas** de l'horizon (date, médiane, basse) ; le premier
  jour où la basse passe sous le seuil ; le **risque** : `probable` si la
  médiane du point bas est sous le seuil, `possible` si seule la basse l'est,
  `none` sinon ; la dépense variable moyenne par jour, pour la ligne
  « Dépenses courantes ≈ 38 €/jour » ;
- le **seuil** est le plancher enregistré dans les alertes
  (`alert_settings.balance_floor_cents`) s'il existe, zéro sinon, et la
  réponse dit lequel.

**Scénarios « Et si… »** (dans `engines/outlook.py`), appliqués aux événements
avant projection, jamais enregistrés :

- dépense ou revenu ponctuel (libellé, date, montant signé) ;
- résilier une série (détectée ou déclarée) à partir d'une date ;
- changer le montant d'une série à partir d'une date.

Vingt ajustements au plus, dates dans l'horizon, montants bornés à 10 M€. La
réponse porte la base et le scénario, et les écarts : solde à l'horizon,
point bas.

**`engines/backtest.py` — la fiabilité mesurée.** Pour chaque fin de mois *c*
de l'historique précédée d'au moins 6 mois complets de part variable et suivie
d'au moins *h* mois de relevés, pour *h* = 1 et 3 : le moteur est rejoué sur
les seules lignes ≤ *c* (détection à la date *c*, libellés écartés appliqués,
**sans déclaration ni événement prévu** : ils n'ont pas d'histoire) ; la
prévision de la fin du mois *c + h* est comparée au solde réel de ce jour.
Par horizon : nombre de rejeux, erreur absolue moyenne et médiane, biais moyen
(réel − prévu : négatif = prévision trop optimiste), nombre de fois où le réel
tombe dans la fourchette annoncée (80 % attendus). Moins de 3 rejeux : refus
avec sa raison (« Il faut au moins 9 mois de relevés pour rejouer la
prévision »).

### Données et routes

Une migration crée `planned_events` :

| Colonne | Type |
|---|---|
| `id` | entier |
| `user_id` | FK `users`, CASCADE, indexée |
| `label` | texte 120, requis |
| `on` | date, requise |
| `amount_cents` | entier signé, non nul et ≠ 0 |
| `account_id` | FK `accounts`, SET NULL, nullable |
| `category_id` | FK `categories`, SET NULL, nullable |
| `notes` | texte 2000, nullable |
| `created_at` | horodatage |

Routes (`api/outlook.py`, `api/planned_events.py`), toutes derrière
`get_current_user`, toutes filtrées sur `user_id` :

- `GET /outlook?scope=checking|liquid&horizon_days=90` — la projection ; porte
  aussi `as_of`, la date du jour, le retard du relevé en jours, les
  avertissements, et le compte des sources (détectées, déclarées, prévues,
  rapprochements) ;
- `POST /outlook/scenario` — `{scope, horizon_days, adjustments[]}` → base,
  scénario, écarts ;
- `GET /outlook/reliability?scope=…` — la fiabilité ;
- `GET /planned-events`, `POST`, `PATCH /{id}`, `DELETE /{id}` — un compte ou
  une catégorie d'un autre foyer est refusé (404), un montant nul ou une date
  illisible aussi (422, en français).

`/cashflow/forecast` reste (les agents s'en servent) avec les deux défauts
corrigés ; le guide agent de Réglages ajoute les routes `/outlook`.

### L'écran

`features/avenir/`, route `/avenir` ; `/tresorerie` y redirige.
L'entrée « Trésorerie » de la barre latérale devient **« Avenir »**, à la même
place, avec les alias « trésorerie », « solde futur », « prévision »,
« découvert », « fin de mois », « point bas », « échéances », « autonomie ».

De haut en bas :

1. **En-tête** : « Avenir — Ce que votre argent va devenir, jour après jour. »
   Contrôles : « Comptes courants | Tout le disponible », « 90 jours |
   12 mois ».
2. **Bandeau de retard**, seulement si le relevé a plus de 7 jours de retard :
   « Vos relevés s'arrêtent au 31 août : tout ce qui suit est projeté. »,
   lien « Importer mes relevés ». Il remplace le paragraphe des « deux
   horloges ».
3. **Trois tuiles réponse** : fin de mois prévue (le mois en cours s'il lui
   reste plus de 7 jours, sinon le suivant) avec « entre X et Y » ; point bas
   avec sa date, son contexte (« veille de la paie » quand un revenu tombe le
   lendemain) et une pastille de risque (« Pas de découvert prévu »,
   « Découvert possible », « Découvert probable ») ; fiabilité (« ±140 € à
   1 mois », « 8 fois sur 9 dans la fourchette ») ou son refus.
4. **Courbe** (ECharts) : fourchette en aire, médiane en trait, seuil en ligne,
   points sur les revenus et les échéances d'au moins 100 €, zone « déjà passé,
   pas encore importé » entre la fin du relevé et aujourd'hui, courbe du
   scénario en pointillé quand un scénario est actif. Infobulle échappée : date,
   médiane, fourchette, événements du jour. Solde de départ nommé dans la tête
   du panneau. Bouton « Exporter » comme les autres graphiques.
5. **Les 30 prochains jours** : par semaine ; date, libellé, pastille de source
   (« détecté », « déclaré », « prévu », « scénario »), montant, solde après ;
   la ligne « Dépenses courantes ≈ 38 €/jour » ; les avertissements de
   déclarations non reliées ; « Ajouter un événement prévu » ouvre un
   formulaire en ligne (libellé, date, montant, sens, compte) ; chaque
   événement prévu a « Modifier » et « Supprimer » (icône + libellé court,
   `aria-label` complet).
6. **Et si…** : les ajustements en liste, chacun retirable ; « Dépense
   ponctuelle », « Revenu ponctuel », « Résilier… », « Changer un
   montant… » ; le résultat en une phrase (« Avec ce scénario : point bas
   −340 € le 27 novembre, au lieu de 212 € le 27 octobre. ») ; « Enregistrer
   comme événement prévu » sur un ajustement ponctuel. Recalcul à chaque
   changement (anti-rebond 300 ms) ; pendant le calcul, seulement « Calcul du
   scénario… ».
7. **Combien de temps sans revenu** : le `RunwayPanel` actuel, déplacé.
8. **Comment c'est calculé** (`design/Method`, replié) : les sources, la règle
   « un euro, une seule source », la fourchette, le profil du mois, ce que le
   rejeu mesure et ce qu'il ne mesure pas.

États : squelettes à la forme du contenu ; une erreur par panneau
(`Promise.allSettled`) ; périmètre sans compte (« Aucun compte courant :
créez-en un dans Import ») ; historique trop court (événements connus
seulement, sans fourchette, avec la raison et le remède). En 390 : tuiles
empilées, courbe pleine largeur, aucune barre de défilement horizontale.

Cibles de l'assistant (`design/ai/targets.ts`) : `kpi-fin-de-mois`,
`kpi-point-bas`, `kpi-fiabilite`, `panel-avenir-courbe`, `panel-a-venir`,
`panel-et-si`, et `kpi-solde-disponible`, `kpi-autonomie`, `panel-prevision`
repointées sur `/avenir`. `ReasoningTrace` et `engines/answer.py` nomment
`/avenir`. `features/cashflow/CashflowPage` et `ForecastFanChart` sont
supprimés une fois sans utilisateur. `dev/mockApi.ts` sert les nouvelles
routes, typées `satisfies` contre `lib/types.ts`.

### Branchements

- **Vue d'ensemble** : panneau « Les 30 prochains jours » sous le panneau de
  tête — point bas et sa pastille, les trois prochaines échéances, lien
  « Voir l'avenir » ; `GET /outlook?scope=checking&horizon_days=30`.
- **Assistant** (déterministe) : deux intentions, chacune déclarée dans
  `trace_query` :
  - `balance_forecast` — « combien j'aurai à la fin du mois / fin décembre /
    dans 3 mois », « serai-je à découvert », « point bas » ; réponse : solde
    médian et fourchette à la date visée, point bas d'ici là, risque ;
    courbe ;
  - `upcoming` — « prochains prélèvements », « qu'est-ce qui tombe cette
    semaine / ce mois-ci / dans 10 jours » ; réponse : les échéances (huit au
    plus) et leur total.
  Le contexte du chat n'assemble les sources d'Avenir que pour ces deux
  intentions.
- **Agent** : outil de lecture `lire_avenir` (point bas, fin de mois,
  prochaines échéances) dans `READ_TOOLS`.
- **Alerte de seuil** : calculée sur le point bas au jour du périmètre
  « Comptes courants » — « Point bas prévu sous votre seuil : 180 € le
  27 octobre (seuil 500 €) », clé `balance_floor:<date>`.

### Tests

- moteurs : `test_outlook_sources.py` (appariement, périmètres, libellés
  écartés gardés dans la part variable, rapprochements, liaison,
  avertissement, expansion de chaque rythme et bornage du jour),
  `test_outlook.py` (sommes au jour, fourchette croissante, profil, mois
  partiel, point bas, trois niveaux de risque, seuil, scénarios, cas sans
  fourchette), `test_backtest.py` (historique déterministe → erreur nulle ;
  bruité → comptes de la fourchette ; refus sur historique court) ;
  `test_forecast.py` inchangé et vert ;
- routes : `test_outlook_api.py` (isolation entre foyers, périmètres, retard,
  422), `test_planned_events_api.py`, non-régressions `test_cashflow_api.py`
  et `test_alerts_api.py`, `test_migrations.py` étendu, intentions et traces
  de l'assistant ;
- frontend : un test par panneau, un test de page sur fixtures, ordre de la
  navigation (`AppShell.test.tsx`), cibles ;
- navigateur : un foyer de démonstration de 18 mois (salaire, loyer,
  abonnements, courses, assurance annuelle, virement mensuel vers un PEA,
  vacances d'été) créé par un script de seed du dépôt, sur l'instance de
  développement seulement.

## U — UX restante

- **Plan prévisionnel** : l'introduction dit ce que l'écran fait (déclarer ce
  que l'on sait d'un mois sans relevé, pour les lectures « Estimé » et « Réel
  complété ») et renvoie vers Avenir pour l'évolution du solde.
- Les défauts trouvés pendant le passage navigateur des chantiers S, Q et AV,
  chacun avec son test.

## Hors périmètre

Les chantiers D (fusion des déclarations), E (foyer partagé) et F (scission,
sauvegarde chiffrée, digest) de la spec du 13 septembre ; les devises ; les
notifications hors application ; l'environnement Investissement (sauf S1 sur
ses graphiques et S4 sur ses écrans).
