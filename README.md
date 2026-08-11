# Yieldo

Application web de finances personnelles, auto-hébergée. Vous déposez vos
relevés bancaires au format CSV, Yieldo les catégorise et vous montre où va
votre argent — mois par mois, année par année.

## Ce que Yieldo est — et n'est pas

**Yieldo est :**
- un logiciel que vous installez et faites tourner **chez vous**, sur votre
  propre machine ;
- un outil de lecture de vos relevés bancaires : vous les exportez vous-même
  depuis le site de votre banque, puis les déposez dans Yieldo ;
- multi-utilisateurs : chaque personne a ses propres comptes, catégories et
  transactions, strictement isolés des autres.

**Yieldo n'est pas :**
- un agrégateur bancaire — aucune connexion directe à votre banque, aucun
  identifiant bancaire n'est jamais demandé ni stocké ;
- un conseiller financier — les chiffres affichés sont des calculs, pas des
  recommandations réglementées ;
- un service hébergé par un tiers — il n'existe pas de « cloud Yieldo » ;
  c'est votre serveur, vos données.

*(Capture d'écran à venir : l'image Docker n'a pas encore été construite ni
lancée par personne — voir « Premier déploiement » ci-dessous.)*

## Installation en une commande

Prérequis sur votre machine Debian :
- [Docker](https://docs.docker.com/engine/install/debian/) et le plugin
  Docker Compose (`docker compose version` doit répondre) ;
- `curl`, pour le contrôle de santé au démarrage.

```bash
git clone <url-du-dépôt> yieldo
cd yieldo
./install.sh install
```

`install.sh install` :
1. cherche un port libre à partir de `8080` (ou de la valeur de
   `YIELDO_PORT` si vous en fixez une), sans jamais écraser un service déjà
   en cours d'exécution sur ce port ;
2. génère une clé secrète (`YIELDO_SECRET_KEY`) unique à votre instance et
   l'écrit dans `.env`, avec les permissions `600` ;
3. construit l'image et démarre le conteneur ;
4. attend que `/api/health` réponde, jusqu'à deux minutes.

À la fin, le script affiche l'adresse (`http://localhost:<port>`). Ouvrez-la
et créez votre compte : **le tout premier compte créé sur une instance
devient automatiquement administrateur.**

## Mise à jour

```bash
./install.sh update
```

Ceci sauvegarde la base, récupère la dernière version (si le dépôt est un
clone Git), reconstruit l'image, applique les migrations de schéma au
démarrage, puis relance le service. Si la nouvelle version ne répond pas au
contrôle de santé, `update` restaure automatiquement la sauvegarde qu'il
vient de faire et relance l'ancienne version — vos données ne restent jamais
sur un schéma à moitié migré.

## Sauvegarde et restauration

```bash
./install.sh backup              # sauvegarde horodatée dans data/backups/
./install.sh restore <fichier>   # restaure une sauvegarde (demande confirmation)
```

`backup` utilise `sqlite3 .backup` quand l'utilitaire est disponible (une
copie cohérente même si la base est en cours d'écriture) et se rabat sur une
copie brute du fichier sinon. Les 10 sauvegardes les plus récentes sont
conservées automatiquement ; `restore` sauvegarde systématiquement l'état
actuel avant de le remplacer, au cas où vous vous seriez trompé de fichier.

`./install.sh uninstall` supprime le conteneur et l'image, mais **conserve
toujours** le dossier `data/`.

## Où vivent les données — et ce qui n'en sort jamais

Tout est dans `./data/`, à la racine du dépôt, monté dans le conteneur en
volume :

- `data/yieldo.db` — la base SQLite : utilisateurs, comptes, catégories,
  transactions, règles apprises ;
- `data/uploads/` — les fichiers CSV en cours d'analyse, purgés après 24 h ;
- `data/backups/` — les sauvegardes horodatées.

`.env`, à la racine, contient `YIELDO_SECRET_KEY` : la clé qui chiffre les
clés d'API que vous pourriez enregistrer dans Yieldo (phase 3) et qui signe
les jetons de connexion. Il n'est jamais versionné (`.gitignore`) et
`install.sh` le crée avec les permissions `600`.

**Rien ne sort de votre machine sans que vous l'ayez explicitement demandé.**
Yieldo ne contacte aucun service externe pour fonctionner : pas de
télémétrie, pas d'appel à une API tierce au quotidien. Les seules
intégrations externes prévues (cours de bourse, cryptomonnaies, taux de
change — phase 3) seront optionnelles et clairement indiquées avant toute
activation. L'assistant conversationnel (phase 4) est déterministe par
défaut ; brancher un LLM externe restera un choix explicite de votre part,
jamais un comportement par défaut.

## Format CSV attendu et taggage des colonnes

Yieldo accepte un fichier `.csv`, `.txt` ou `.tsv` de 20 Mo maximum. Il n'y a
pas de format imposé : au dépôt du fichier, Yieldo détecte automatiquement
l'encodage, le séparateur de colonnes, le séparateur décimal et le format de
date les plus probables — et vous les montre, modifiables, avant toute
analyse.

Ce que Yieldo ne devine jamais à votre place : **le rôle de chaque colonne**.
Après le dépôt du fichier, un tableau de correspondance s'affiche avec un
rôle pré-proposé pour chaque colonne (Date, Libellé, Débit/Crédit ou
Montant, etc.) — mais chaque proposition reste un menu déroulant que vous
pouvez corriger. Rien n'est importé tant que vous n'avez pas validé cet
écran, et toute modification relance l'aperçu pour que ce que vous voyez
corresponde toujours à ce qui sera réellement importé.

Un relevé doit fournir au minimum :
- une colonne **Date** ;
- une colonne **Libellé** (le texte brut de la transaction, jamais modifié) ;
- soit une colonne **Montant** signée, soit un couple **Débit** / **Crédit**.

Les lignes déjà importées (même compte, même date, même montant, même
libellé) sont détectées comme doublons et exclues par défaut — vous pouvez
choisir de les importer quand même, ligne par ligne.

## Dépannage

**Le port habituel est occupé.**
`install.sh` cherche automatiquement un port libre à partir de `8080` (ou de
`YIELDO_PORT` si vous l'avez fixé dans l'environnement) et vous indique celui
qu'il a retenu. Si vous voulez forcer un port précis, éditez `YIELDO_PORT`
dans `.env` puis relancez `./install.sh restart` — si ce port est déjà pris,
le prochain `install`/`update` en retiendra un autre automatiquement.

**Docker n'est pas installé, ou le démon ne répond pas.**
`install.sh` s'arrête avec un message explicite dans ces deux cas plutôt que
d'échouer plus loin de façon confuse. Installez Docker Engine et le plugin
Compose ([documentation officielle
Debian](https://docs.docker.com/engine/install/debian/)), démarrez le
service (`sudo systemctl start docker`), et si l'erreur porte sur les droits,
ajoutez votre utilisateur au groupe `docker` (`sudo usermod -aG docker
$USER`, puis reconnectez-vous) plutôt que de lancer `install.sh` en `sudo`.

**J'ai perdu `SECRET_KEY` (le fichier `.env` a disparu).**
`YIELDO_SECRET_KEY` signe les jetons de connexion : sans elle, toutes les
sessions existantes deviennent invalides et tout le monde doit se
reconnecter — c'est sans gravité en soi. En revanche, en phase 3, cette même
clé chiffrera les clés d'API que vous aurez enregistrées dans Yieldo ; si
`.env` disparaît à ce moment-là, ces clés chiffrées dans `data/yieldo.db`
deviennent illisibles et devront être ressaisies. Il n'existe aucun moyen de
« retrouver » une clé perdue — la seule protection est de sauvegarder `.env`
vous-même, en dehors du dépôt (un gestionnaire de mots de passe, un coffre
chiffré séparé). `install.sh` n'en génère une nouvelle que si `.env` est
totalement absent ; il ne régénère jamais silencieusement une clé existante.

## Premier déploiement — ce qu'il reste à vérifier

Ce dépôt a été développé et testé **sans Docker installé sur la machine de
développement**. Concrètement, à ce stade :

- `docker build`, `docker compose up`, le contrôle de santé du conteneur et
  `alembic upgrade head` exécuté dans l'image n'ont **jamais été lancés par
  personne** ;
- le test bout en bout (`e2e/tests/onboarding.spec.ts`) est écrit, relu contre
  le code réel des composants qu'il pilote, et prêt à s'exécuter — mais
  **n'a jamais tourné contre une instance réelle** ;
- la branche `ss -tuln` de la détection de port dans `install.sh` (utilisée
  en priorité sur Debian) n'a été exercée que sur Windows, où elle n'est pas
  disponible et où le script se rabat sur une sonde Python.

**À la première installation, vérifiez donc, dans l'ordre :**

1. `./install.sh install` se termine sur `Yieldo est accessible sur
   http://localhost:<port>` — sinon, `./install.sh logs` pour voir où la
   construction ou le démarrage a échoué.
2. Le conteneur démarre bien en tant qu'utilisateur non-root une fois les
   migrations appliquées (`docker compose logs` doit montrer `[yieldo]
   applying database migrations…` puis `[yieldo] starting application`, sans
   erreur de permission sur `/app/data`).
3. `data/yieldo.db` est créé avec pour propriétaire l'utilisateur `1000:1000`
   à l'intérieur du conteneur (`docker compose exec yieldo ls -la
   /app/data`) — un dossier `data/` pré-existant appartenant à un autre
   utilisateur sur l'hôte est le cas que l'entrypoint corrige automatiquement
   au démarrage ; vérifiez que la correction a bien eu lieu.
4. La création de compte, l'import d'un CSV et le tableau de bord
   fonctionnent de bout en bout dans un navigateur.
5. `cd e2e && npm install && npx playwright install chromium && npx
   playwright test` passe contre cette instance (`YIELDO_URL` pointant
   dessus si elle n'écoute pas sur `8080`).
6. `./install.sh update` conserve bien les données existantes (créez une
   transaction de test avant, vérifiez qu'elle est toujours là après).
7. Contrôle manuel : basculez le thème clair / sombre sur chaque écran, puis
   activez « réduire les animations » au niveau du système et vérifiez que
   l'interface reste utilisable.

Si l'un de ces points échoue, c'est un bug de la phase 1, pas une omission
de ce document — merci de le signaler.

## Feuille de route

**Phase 1 — Socle (actuelle).** Import CSV avec taggage explicite des
colonnes, catégorisation par règles et apprentissage des corrections,
authentification multi-utilisateurs, agrégation temporelle (jour, mois,
année), tableau de bord et vue transactions, Docker et `install.sh` complets.

**Phase 2 — Analyse et décision.** Budgets par catégorie, détection des
dépenses récurrentes, prévision de trésorerie et runway, détection
d'anomalies, inflation personnelle, simulateurs (achat, crédit, épargne,
immobilier), dettes et objectifs d'épargne.

**Phase 3 — Patrimoine et marchés.** Comptes d'investissement et positions,
intégrations boursières et cryptomonnaies (optionnelles, à activer
explicitement), valorisation du patrimoine, allocation et rééquilibrage,
simulation Monte Carlo, projection FIRE / retraite, fiscalité française.

**Phase 4 — Assistant.** Chat déterministe sur vos propres données, export
de contexte filtrable, connexion optionnelle à un LLM externe de votre
choix, rapports PDF, alertes.

## Développement

```bash
# Backend
cd backend && ./.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing

# Frontend
cd frontend && npm test && npm run build

# Harnais de tests d'install.sh (sans Docker)
bash tests/install/test_find_port.sh

# Test bout en bout (nécessite une instance en cours d'exécution)
cd e2e && npm install && npx playwright install chromium && npx playwright test
```

État courant : 210 tests backend (couverture 95 % globale, ≥ 93 % sur
`app/engines` et `app/importers`), 210 tests frontend, build TypeScript sans
erreur, 14 vérifications `install.sh` au vert.
