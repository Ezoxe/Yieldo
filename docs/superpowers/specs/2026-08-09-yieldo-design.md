# Yieldo — Design

**Date:** 2026-08-09
**Statut:** validé, prêt pour planification
**Remplace:** `com.ezgalaxy.finvest` (EZGalaxy catalog)

---

## 1. Objectif

Yieldo est une application web auto-hébergée de finances personnelles. Elle
ingère des relevés bancaires au format CSV, en tire un historique de
transactions exploitable au jour, au mois et à l'année, et répond à des
questions de décision concrètes : « Puis-je m'offrir cette voiture à 40 000 €
dans un an ? Sinon, que dois-je changer ? »

Elle succède à FinVest, dont elle reprend les moteurs de calcul en les
fiabilisant, et comble sa lacune principale : FinVest reposait sur des données
déclarées à la main par l'utilisateur. Yieldo repose sur les transactions
réelles.

### Ce que Yieldo n'est pas

- Pas un agrégateur bancaire. Aucune connexion directe aux banques, aucun
  identifiant bancaire stocké. L'utilisateur exporte ses relevés lui-même.
- Pas un conseiller financier. Les analyses sont des calculs, pas des
  recommandations réglementées. L'interface le rappelle explicitement.
- Pas un service hébergé. C'est un logiciel que l'utilisateur installe sur sa
  propre machine.

---

## 2. Décisions structurantes

| Sujet | Décision |
|---|---|
| Stack | React 19 + TypeScript + Vite (frontend), FastAPI + SQLAlchemy (backend), SQLite en mode WAL |
| Déploiement | Un container Docker unique sur Debian, orchestré par `install.sh` |
| Utilisateurs | Multi-utilisateurs complet, inscription ouverte ou sur invitation |
| Assistant | Moteur déterministe par défaut ; LLM externe optionnel branché par l'utilisateur |
| Fiscalité | France, en profondeur |
| Catégorisation | Règles préinstallées + apprentissage local des corrections manuelles |
| Import CSV | Taggage explicite des colonnes par l'utilisateur à chaque dépôt |
| Gamification | Version allégée : streaks, jalons, santé financière, défis ancrés sur les données réelles. Pas d'XP ni de niveaux |
| Direction visuelle | Abysse — bleu nuit, teal, vert menthe, thèmes clair et sombre |
| Cible matérielle | 8 à 16 Go de RAM |
| Langue | Français, interface et données |
| Devise | Euro par défaut, autres devises converties à l'affichage |

---

## 3. Architecture

### 3.1 Structure du dépôt

```
Yieldo/
├── backend/
│   ├── app/
│   │   ├── main.py              point d'entrée FastAPI
│   │   ├── config.py            réglages par variables d'environnement
│   │   ├── db.py                session SQLAlchemy, moteur SQLite
│   │   ├── models/              tables ORM
│   │   ├── schemas/             modèles Pydantic entrée/sortie
│   │   ├── api/                 routeurs REST, un par domaine
│   │   ├── engines/             calculs financiers purs, sans I/O
│   │   ├── importers/           détection, mapping, parsing, dédoublonnage
│   │   ├── nlq/                 parsing d'intention pour le chat déterministe
│   │   ├── context/             génération de l'export de contexte IA
│   │   └── security/            hachage, JWT, chiffrement des secrets
│   ├── alembic/                 migrations
│   ├── tests/
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── app/                 routage, layout, fournisseurs
│   │   ├── design/              tokens, primitives verre, motion
│   │   ├── charts/              composants ECharts encapsulés
│   │   ├── features/            un dossier par domaine métier
│   │   ├── lib/                 client API, hooks, formatage
│   │   └── types/               types générés depuis l'OpenAPI
│   ├── tests/
│   └── package.json
├── docker/
│   ├── Dockerfile               build multi-étages
│   └── entrypoint.sh
├── docs/
├── docker-compose.yml
├── .env.example
└── install.sh
```

### 3.2 Container unique

Le build multi-étages compile le frontend avec Node, puis copie les fichiers
statiques dans l'image Python finale. FastAPI sert l'API sous `/api` et le SPA
sur toutes les autres routes. Un seul processus, un seul port, un seul volume.

Justification : pour du self-hosted mono-machine, un container unique supprime
les problèmes de réseau inter-services, de dépendances au démarrage et de
version désynchronisée entre frontend et backend. SQLite en mode WAL supporte
sans difficulté la charge d'un foyer ou d'une petite équipe.

Le volume `./data` contient `yieldo.db`, les CSV originaux archivés, et les
sauvegardes. Il n'est jamais reconstruit lors d'une mise à jour.

### 3.3 install.sh

Script POSIX unique, idempotent, avec sous-commandes.

- `install` — vérifie la présence de Docker et Compose, trouve le premier port
  TCP libre à partir de 8080 en interrogeant `ss -tuln`, génère un `SECRET_KEY`
  aléatoire, écrit `.env`, construit l'image, applique les migrations, démarre,
  attend que `/api/health` réponde, affiche l'URL d'accès.
- `update` — sauvegarde la base, `git pull`, reconstruit, applique les
  migrations, redémarre. Restaure automatiquement la sauvegarde si le contrôle
  de santé échoue. Le volume de données n'est jamais supprimé.
- `backup` — copie horodatée de `yieldo.db` via l'API de sauvegarde SQLite
  (cohérente même à chaud), conserve les 10 dernières.
- `restore <fichier>` — restauration après confirmation explicite.
- `logs`, `status`, `stop`, `start`, `restart` — passe-plats vers Compose.
- `uninstall` — arrête et supprime le container, **conserve `./data`** et le
  dit clairement.

Le port retenu est mémorisé dans `.env` et réutilisé aux redémarrages
suivants, pour que l'URL ne change pas d'une fois sur l'autre. Un port peut
être imposé par `PORT=9000 ./install.sh install`.

### 3.4 Sécurité

- Mots de passe hachés en **Argon2id**. FinVest utilisait SHA-256 salé, sans
  étirement de clé, donc vulnérable au cassage par force brute sur GPU.
- Jetons JWT courts avec jeton de rafraîchissement en cookie `HttpOnly`,
  `SameSite=Strict`.
- Chaque table métier porte une clé étrangère `user_id`. Toutes les requêtes
  passent par une dépendance qui injecte l'utilisateur courant et filtre
  dessus. Il n'existe pas de chemin de lecture sans filtre.
- Les clés API tierces sont chiffrées au repos en Fernet, avec une clé dérivée
  du `SECRET_KEY`. Elles ne sont jamais renvoyées en clair au frontend — seuls
  un statut et les quatre derniers caractères sont exposés. Elles ne sont
  jamais écrites dans les journaux.
- Conséquence à assumer : le `SECRET_KEY` est généré une seule fois, à la
  première installation, puis conservé dans `.env`. `install.sh` ne le
  régénère jamais si le fichier existe, et `backup` l'inclut. Le perdre
  invalide les clés API stockées et déconnecte les sessions — pas les données
  financières, qui ne sont pas chiffrées par cette clé. Un message
  d'avertissement explicite le rappelle après l'installation.
- Les appels aux APIs externes passent par le backend, jamais par le
  navigateur, pour que les clés ne quittent pas le serveur.
- Le premier compte créé devient administrateur. Un réglage décide si
  l'inscription reste ouverte ou passe sur invitation.
- Limitation de débit sur les routes d'authentification.
- En-têtes de sécurité stricts, politique de sécurité de contenu restrictive.

---

## 4. Modèle de données

### 4.1 Tables

**`users`** — id, email, nom, hachage du mot de passe, rôle, préférences,
date de création.

**`accounts`** — comptes financiers de l'utilisateur : courant, livret,
PEA, assurance-vie, PER, compte-titres, crypto, immobilier, prêt. Porte un
type, une devise, un solde d'ouverture, une date d'ouverture, et un indicateur
d'inclusion dans le patrimoine net.

**`transactions`** — la table centrale.

| Colonne | Rôle |
|---|---|
| `id`, `user_id`, `account_id` | identité et rattachement |
| `date` | date de valeur, indexée |
| `amount` | décimal signé ; négatif = sortie |
| `label_raw` | libellé brut du relevé, jamais modifié |
| `label_clean` | libellé normalisé pour l'affichage et la recherche |
| `merchant` | marchand extrait, quand identifiable |
| `category_id` | catégorie assignée |
| `category_source` | `rule`, `learned`, `manual`, `csv`, `uncategorized` |
| `is_transfer` | virement interne, exclu des dépenses |
| `is_recurring`, `recurrence_id` | rattachement à une récurrence détectée |
| `import_batch_id` | lot d'import d'origine |
| `dedup_hash` | empreinte de dédoublonnage, unique par utilisateur |
| `notes`, `tags` | annotations libres |

**`categories`** — arborescence à deux niveaux, préinstallée en français
(Logement, Alimentation, Transport, Santé, Loisirs, Abonnements, Épargne,
Revenus, Impôts, Divers), entièrement éditable. Porte un budget mensuel
facultatif, une couleur, une icône.

**`rules`** — motif de correspondance (sous-chaîne ou expression régulière) →
catégorie, avec une priorité et une origine (`builtin`, `learned`, `manual`).
Les règles apprises naissent des corrections manuelles de l'utilisateur.

**`import_batches`** — nom de fichier, empreinte du fichier, mapping de
colonnes utilisé, compte cible, nombre de lignes importées, ignorées,
dupliquées, horodatage. Permet d'annuler un import entier.

**`column_profiles`** — mapping de colonnes enregistré et nommé
(« Boursorama », « Crédit Agricole »), rappelable en un clic mais toujours
modifiable avant validation.

**`recurrences`** — récurrences détectées : libellé, périodicité, montant
moyen, écart-type, prochaine date attendue, dérive de prix constatée, statut
(active, interrompue, en hausse).

**`assets`** — positions d'investissement : symbole, quantité, prix de
revient moyen, devise, rattachement à un compte. `asset_valuations` conserve
l'historique des valorisations.

**`debts`** — capital restant dû, taux, mensualité, durée, type.

**`goals`** — objectifs d'épargne : intitulé, montant cible, échéance,
montant déjà constitué, priorité.

**`scenarios`** — simulations enregistrées, comparables entre elles.

**`snapshots`** — photographies mensuelles du patrimoine net, pour la courbe
historique.

**`app_settings`**, **`api_credentials`** — réglages et secrets chiffrés.

### 4.2 Dédoublonnage

`dedup_hash = sha256(user_id, account_id, date, amount, normalisation(label_raw))`

La normalisation met en minuscules, réduit les espaces, retire la ponctuation
et les numéros de séquence variables. Une contrainte d'unicité sur
`(user_id, dedup_hash)` rend l'import idempotent : réimporter un fichier qui
chevauche le précédent n'ajoute que les lignes nouvelles.

Cas limite assumé : deux achats identiques le même jour au même montant chez
le même marchand sont considérés comme un doublon. L'écran de
prévisualisation les signale et l'utilisateur peut les conserver
explicitement.

---

## 5. Import CSV

L'utilisateur dépose un fichier et suit quatre étapes. Rien n'est écrit en
base avant la validation finale.

### Étape 1 — Détection

Le backend analyse le fichier et propose : encodage (UTF-8, Latin-1,
Windows-1252), séparateur, séparateur décimal, format de date, ligne
d'en-tête, lignes de préambule bancaire à ignorer. Chaque proposition est
affichée et modifiable.

### Étape 2 — Taggage des colonnes

Le tableau des premières lignes s'affiche. Au-dessus de chaque colonne, un
sélecteur où l'utilisateur choisit le rôle :

`Date` · `Date de valeur` · `Montant` · `Débit` · `Crédit` · `Libellé` ·
`Catégorie` · `Compte` · `Devise` · `Solde` · `Notes` · `Référence` ·
`Ignorer`

L'auto-détection **présélectionne** ces rôles, elle ne les impose jamais.
L'utilisateur peut tout réassigner. C'est le point explicitement demandé :
les CSV changent, le mapping s'adapte sans modification du code.

Cas gérés : colonne montant unique signée, ou colonnes débit et crédit
séparées ; dates au format français, ISO ou américain ; montants avec virgule
décimale et séparateur de milliers ; colonnes surnuméraires ignorées.

Le mapping peut être enregistré sous un nom pour les prochains imports.

### Étape 3 — Prévisualisation

Affiche les lignes analysées avec leur catégorie proposée et l'origine de
cette catégorie, les doublons détectés et surlignés, les lignes en erreur avec
le motif, les montants aberrants signalés, et un résumé : période couverte,
total des entrées, total des sorties, nombre de lignes retenues.

L'utilisateur peut corriger une catégorie ici. Chaque correction crée une
règle apprise qui s'appliquera aux imports suivants.

### Étape 4 — Validation

Import atomique en une transaction. Le fichier original est archivé dans le
volume de données. Le lot reste annulable : un bouton supprime toutes les
transactions du lot et rétablit l'état antérieur.

### Formats

CSV en phase 1. XLSX, OFX et QIF en phase 2 — ce sont des formats d'export
bancaires courants et le pipeline de mapping les accueille sans
modification structurelle.

---

## 6. Moteurs de calcul

Les moteurs sont des fonctions pures : elles reçoivent des données, renvoient
des résultats, ne touchent ni à la base ni au réseau. Cela les rend testables
unitairement et réutilisables entre l'API, le chat déterministe et l'export de
contexte.

### 6.1 Repris de FinVest et fiabilisés

Score de santé financière, score de risque, solde mensuel, fonds d'urgence,
analyse de dettes avec échéancier boule de neige et avalanche, allocation de
portefeuille, rééquilibrage, intérêts composés, simulation de Monte Carlo,
projection de retraite, impact de l'inflation, ratios financiers, optimisation
fiscale, FIRE, simulateur de crédit, dividendes, analyse what-if, stress-test,
comparaison de scénarios, heatmap, simulateur immobilier, performance de
portefeuille.

Corrections apportées : les moteurs FinVest travaillaient sur des données
déclarées ; ils travaillent désormais sur les transactions réelles quand elles
existent, avec repli sur les valeurs déclarées sinon. Les calculs monétaires
passent en décimal exact, plus en virgule flottante.

### 6.2 Nouveaux moteurs

**Agrégation temporelle.** Vue au jour, à la semaine, au mois, au trimestre,
à l'année ; par catégorie, marchand, compte, méthode de paiement. Comparaisons
période à période et année sur année. Moyennes mobiles. C'est la fondation de
toutes les analyses.

**Détection de récurrences.** Regroupe les transactions par similarité de
libellé et de montant, teste la régularité des intervalles, en déduit une
périodicité. Produit la liste des abonnements et prélèvements, détecte les
hausses de prix (« Netflix : 13,49 € → 15,99 € en mars 2026, +18,5 % »),
signale les prélèvements attendus mais absents, et calcule le coût annuel
total des abonnements.

**Prévision de trésorerie.** Projette 12 mois à partir des récurrences
détectées et de la saisonnalité observée sur l'historique réel. Renvoie un
intervalle de confiance, pas une valeur unique. Signale les mois où le solde
projeté passe sous un seuil.

**Runway.** Nombre de mois tenables sans revenu, au rythme de dépense réel
mesuré, avec un scénario normal et un scénario de dépenses réduites au strict
nécessaire.

**Inflation personnelle.** Évolution du coût du panier réel de l'utilisateur,
catégorie par catégorie, comparée à l'indice INSEE. Répond à « où mon argent
part-il davantage qu'avant ? ».

**Détection d'anomalies.** Écart statistique par rapport à l'historique de la
catégorie, méthode robuste (médiane et écart absolu médian) pour ne pas être
faussée par les valeurs extrêmes. Évite les seuils arbitraires.

**Engagement.** Version allégée de la gamification de FinVest, sans XP ni
niveaux. Quatre mécaniques, toutes ancrées sur des données réelles :

- *Streak de suivi* — nombre de mois consécutifs où les relevés ont été
  importés. Mesure une habitude réelle, pas un score artificiel.
- *Jalons d'objectifs* — étapes intermédiaires automatiques (25 %, 50 %,
  75 %) sur chaque objectif d'épargne, avec la date projetée d'atteinte.
- *Santé financière évolutive* — le score et ses composantes suivis dans le
  temps, avec ce qui l'a fait bouger.
- *Défis dérivés des données* — propositions concrètes issues de l'analyse
  (« trois abonnements à 34 €/mois inutilisés depuis six mois »,
  « ramener Restaurants au niveau de 2025 libère 87 €/mois »), acceptables
  ou rejetables, avec suivi du résultat réel le mois suivant.

Aucun badge décoratif, aucun titre, aucun élément qui ne corresponde pas à
une action mesurable.

### 6.3 Moteur de faisabilité d'achat

Le cœur de la demande. Entrée : montant cible, échéance, nature du bien,
apport disponible.

Sortie :

1. **Capacité d'épargne réelle**, mesurée sur les transactions des douze
   derniers mois, pas déclarée. Avec sa variabilité.
2. **Verdict** : atteignable confortablement, atteignable en serrant, hors de
   portée — avec l'écart chiffré.
3. **Coût total de possession**, pas seulement le prix d'achat. Pour un
   véhicule : assurance, entretien, carburant, décote, projetés sur cinq ans.
   Les postes sont préremplis par des moyennes françaises et ajustables.
4. **Coût d'opportunité** : ce que la somme aurait produit si elle avait été
   investie, sur le même horizon, aux hypothèses de rendement configurées.
5. **Leviers chiffrés et classés**, quand l'objectif n'est pas atteignable :
   - épargner X € de plus par mois, avec l'effort que cela représente par
     rapport à la capacité mesurée
   - décaler l'achat de N mois
   - réduire la cible à Y € pour tenir l'échéance
   - emprunter Z € : mensualité, coût total du crédit, taux d'endettement
     résultant, et alerte si le seuil de 35 % est franchi
   - réduire telle catégorie de dépense, avec le montant nécessaire et
     l'historique qui dit si c'est réaliste
6. **Comptant contre crédit contre location avec option d'achat.** Calcule le
   seuil de taux à partir duquel emprunter devient rationnel : si l'épargne
   rapporte plus que le coût du crédit, payer comptant détruit de la valeur.
7. **Impact simulé** sur le fonds d'urgence, le patrimoine net à horizon cinq
   ans, et le score de santé financière.

Chaque scénario est enregistrable et comparable aux autres.

---

## 7. Interface

### 7.1 Direction visuelle — Abysse

Fond bleu nuit profond en dégradé de maillage animé lentement. Accent teal
`#7ee2d6`, vert menthe `#4fd6a8` pour le positif, bleu `#3b82f6` pour le
neutre informatif, orange `#f4a261` pour l'avertissement, rouge corail
`#e5606b` pour le négatif. Thème clair équivalent, avec les mêmes teintes
réétalonnées pour respecter les contrastes.

**Verre liquide, appliqué avec discipline.** Le verre est un matériau de
surface : cartes flottantes en `backdrop-filter`, liseré lumineux sur le bord
supérieur, reflet spéculaire qui suit le curseur, ombres portées douces. Mais
les zones de données — tableaux, axes, valeurs — reposent sur des fonds
opaques. Un chiffre ne se lit pas à travers du flou.

Typographie : Geist pour le texte, Geist Mono à chiffres tabulaires pour tous
les montants, pour que les colonnes s'alignent. Polices auto-hébergées, aucun
appel à un CDN.

Une seule couleur d'accent par écran. Densité réglable entre confortable et
compact.

### 7.2 Animations

Bibliothèque Motion, transformations accélérées par le GPU uniquement.

Chiffres qui s'incrémentent à l'apparition. Courbes qui se tracent. Barres qui
poussent depuis la base. Transitions partagées : une carte cliquée s'étend en
page plutôt que de disparaître. Entrées décalées dans les listes et les
graphiques. Reflet spéculaire au survol des surfaces de verre. Transitions
fluides des graphiques au changement de période.

`prefers-reduced-motion` est respecté intégralement, et un réglage permet de
tout désactiver.

### 7.3 Graphiques — ECharts

- Courbe de patrimoine net avec zoom-brosse et annotations d'événements
- Diagramme de Sankey des flux de trésorerie : origine et destination de
  l'argent
- Calendrier-heatmap des dépenses quotidiennes sur plusieurs années
- Treemap des catégories, forable vers les sous-catégories
- Éventail de percentiles P10/P50/P90 pour Monte Carlo — jamais une ligne
  unique, qui donnerait une fausse impression de certitude
- Cascade mensuelle revenus → dépenses → épargne
- Radar de santé financière
- Superposition de scénarios comparés
- Courbes de projection avec bandes de confiance

Chaque graphique est exportable en PNG et en CSV de ses données sources.
Chaque graphique a un état vide explicite et un état de chargement en
squelette.

### 7.4 Écrans

Vue d'ensemble, transactions, budget, catégories, récurrences, trésorerie,
patrimoine, investissements, dettes, objectifs, simulateurs, faisabilité
d'achat, fiscalité, rapports, assistant, import, réglages.

---

## 8. Assistant et export de contexte

### 8.1 Chat déterministe

L'utilisateur écrit en français. Un analyseur d'intention extrait la période,
la catégorie, le montant, l'horizon, l'entité, puis appelle le moteur de
calcul correspondant. La réponse contient des chiffres exacts et le graphique
pertinent, en quelques millisecondes.

Intentions couvertes : totaux et moyennes par période et catégorie,
comparaisons entre périodes, évolution d'un poste, faisabilité d'achat,
simulation d'épargne, état d'un objectif, coût des abonnements, recherche de
transactions, projection de patrimoine.

Chaque réponse affiche la requête exécutée, en clair. L'utilisateur peut
vérifier ce qui a été calculé. Quand l'intention n'est pas reconnue,
l'assistant le dit et propose les formulations qu'il comprend — il n'invente
jamais de réponse.

### 8.2 Export de contexte

Panneau de sélection du périmètre :

- **Période** — années ou plage de dates. « Dépenses 2025 et 2026 seulement »
  exclut effectivement 2024.
- **Comptes** et **catégories** à inclure.
- **Granularité** — agrégats annuels, mensuels, ou transaction par
  transaction.
- **Modules** — profil, budget, patrimoine, dettes, objectifs, positions,
  récurrences, analyses, projections, fiscalité.
- **Anonymisation** facultative — montants en valeurs relatives, marchands
  masqués.

Produit un document Markdown structuré et lisible par un modèle de langage,
avec une estimation du nombre de tokens et un avertissement si le volume
dépasse la fenêtre de contexte du modèle visé. Copiable en un clic,
téléchargeable en `.md`, `.txt` ou `.json`.

Gabarits prêts à l'emploi : bilan annuel, faisabilité d'achat, revue de
portefeuille, optimisation fiscale, diagnostic budgétaire. Chacun précoche le
périmètre pertinent et ajoute la question à poser au modèle.

### 8.3 LLM optionnel

Réglages → l'utilisateur saisit une URL d'endpoint compatible OpenAI et un nom
de modèle. Compatible avec Ollama, LM Studio, llama.cpp et vLLM en local, ou
avec les API Gemini, Claude et OpenAI en ligne moyennant une clé.

Contrat strict : **le modèle ne calcule jamais**. Le moteur déterministe
produit les chiffres, le modèle les commente et les met en perspective. Les
chiffres affichés proviennent toujours du moteur.

Désactivé, l'application reste pleinement fonctionnelle.

---

## 9. Intégrations externes

| Service | Usage | Quota gratuit | Clé |
|---|---|---|---|
| Finnhub | Cours actions, bougies, actualités | 60/min | requise |
| Alpha Vantage | Historiques, indicateurs techniques | 25/jour | requise |
| ExchangeRate-API | Taux de change | 1 500/mois | requise |
| CoinGecko | Cours crypto | ~30/min | non |
| Frankfurter | Taux BCE | illimité | non |
| LLM au choix | Assistant optionnel | — | selon fournisseur |

Toutes les clés sont saisies par l'utilisateur dans l'écran Réglages →
Connexions, après installation. Aucune clé n'est livrée avec le code.

Le backend gère un pool de quotas persistant : compteurs par service et par
fenêtre, limitation préventive à 80 % du quota, cache à durée de vie adaptée
au type de donnée, repli sur la dernière valeur connue quand le quota est
épuisé. L'interface affiche l'état des quotas et la date de réinitialisation.

Toute l'application fonctionne sans aucune clé : seules les fonctions de
marché en temps réel sont indisponibles.

---

## 10. Gestion des erreurs

**Import** — les erreurs sont par ligne, pas par fichier. Une ligne illisible
n'annule pas l'import ; elle est signalée avec son numéro et son motif dans
l'écran de prévisualisation. L'écriture en base est atomique et annulable.

**Calculs** — les moteurs valident leurs entrées et renvoient des erreurs
typées. Les hypothèses (taux de rendement, inflation, horizon) sont toujours
affichées à côté du résultat. Les projections indiquent leur incertitude.

**Réseau** — les appels externes ont un délai d'expiration, se replient sur le
cache, et l'interface indique clairement quand une donnée est en cache et
depuis quand. Une API indisponible dégrade la fonction concernée, jamais
l'application.

**Frontend** — barrières d'erreur par route. Une vue en échec n'emporte pas le
reste de l'application.

Aucun échec n'est silencieux. Aucune valeur de repli ne se fait passer pour
une donnée réelle.

---

## 11. Tests

**Backend.** Les moteurs de calcul sont testés unitairement contre des cas de
référence vérifiés à la main — un échéancier de crédit, une projection
d'intérêts composés, un calcul de fonds d'urgence. Les importateurs sont
testés sur des fichiers d'exemple couvrant les formats bancaires français
courants, y compris les cas tordus : encodages exotiques, colonnes débit et
crédit séparées, préambules. Les routes API sont testées pour l'isolation
entre utilisateurs : un utilisateur ne doit jamais atteindre les données d'un
autre. Objectif de couverture : 80 % sur `engines/` et `importers/`.

**Frontend.** Tests de composants sur le comportement observable, pas sur les
détails d'implémentation. Tests d'accessibilité automatisés.

**Bout en bout.** Les parcours critiques : inscription, import d'un CSV avec
taggage des colonnes, consultation du tableau de bord, simulation d'un achat,
export de contexte.

---

## 12. Phases

### Phase 1 — Socle

Docker et `install.sh` complets. Authentification multi-utilisateurs. Import
CSV avec taggage explicite des colonnes. Catégorisation par règles et
apprentissage. Agrégation temporelle jour, mois, année. Vue d'ensemble et vue
transactions. Système de design Abysse complet. Premiers graphiques.

*Critère de réussite : l'utilisateur dépose son CSV et voit son historique
financier correctement catégorisé et navigable dans le temps.*

### Phase 2 — Analyse et décision

Budgets par catégorie. Détection des récurrences. Prévision de trésorerie.
Runway. Détection d'anomalies. Inflation personnelle. Moteur de faisabilité
d'achat. Simulateurs crédit, épargne et immobilier. Dettes et objectifs.
Mécaniques d'engagement : streak, jalons, santé évolutive, défis dérivés des
données.

*Critère de réussite : « puis-je m'offrir cette voiture ? » reçoit une réponse
chiffrée assortie de leviers concrets.*

### Phase 3 — Patrimoine et marchés

Comptes d'investissement et positions. Intégrations Finnhub, Alpha Vantage,
CoinGecko, Frankfurter, ExchangeRate-API avec pool de quotas. Valorisation du
patrimoine. Allocation et rééquilibrage. Monte Carlo. FIRE. Retraite.
Fiscalité française. Stress-tests.

*Critère de réussite : patrimoine complet valorisé et projeté.*

### Phase 4 — Assistant

Chat déterministe. Export de contexte filtrable. LLM optionnel. Rapports PDF.
Alertes et notifications.

*Critère de réussite : l'utilisateur pose une question en français et obtient
une réponse exacte, ou exporte un contexte sur mesure vers l'IA de son choix.*

---

## 13. Hors périmètre

Connexion bancaire directe, application mobile native, fonctions
collaboratives ou sociales, exécution d'ordres de bourse, conseil financier
réglementé, import de formats bancaires non standards en phase 1.
