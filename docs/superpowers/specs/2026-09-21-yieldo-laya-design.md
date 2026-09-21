# Laya derrière le pilote — un encodeur System One, auto-hébergé sur CPU

Date : 2026-09-21. Chantier de l'environnement Investissement.

## Ce qu'on branche, et pourquoi ce n'est pas un LLM de plus

Laya (`convaiinnovations/laya`, Apache 2.0) est un encodeur — ModernBERT-large
plus une tête de décision entraînée de zéro, 421 M de paramètres — qui répond
aux trois mêmes formes typées que Jev : `choice`, `score`, `noul`. Il ne génère
pas de texte : une réponse hors contrat n'est pas refusée, elle n'est pas
représentable. Il rend en plus **la masse de probabilité par option** et **par
niveau de note**, ce qu'aucun des fournisseurs actuels ne montre.

Il ne tourne que par son paquet Python (PyTorch, CPU accepté : 193–464 ms par
appel, chiffres officiels). Aucun serveur HTTP n'est livré ; ni vLLM ni
llama.cpp ne peuvent le servir. Le serveur, c'est Yieldo qui le fournit.

Deux faits qui bornent l'ambition, et que l'écran doit rendre visibles :

- **Surconfiance à la sortie de la boîte** : ECE 0,466 avant recalibrage.
  Le mandat dimensionne les positions sur la conviction et la probabilité ;
  un modèle qui annonce 90 % et réalise 50 % engage le plafond sur rien.
- **Zero-shot proche du hasard** sur les décisions typées pour les
  checkpoints de base (0,35 contre 0,318 au hasard) ; `typed-decisions` a été
  affiné sur quatre flux métier (factures, sécurité, support, observabilité),
  pas sur des séries de prix. Que Laya tranche sensément sur neuf indicateurs
  de marché n'est pas acquis.

D'où le principe du chantier : **brancher, et instrumenter la comparaison**.
Le panneau de calibration mesure la surconfiance ; un second avis du moteur
déterministe, rangé à côté de chaque décision, mesure si Laya bat quatre
règles de momentum. Yieldo ne tranche pas cette question ; il la rend lisible.

## Les pièces

### 1. `tools/laya-server/` — le serveur, hors de l'image Yieldo

Un paquet à part, parce que torch pèse 1,2 Go et n'a rien à faire dans
l'image de l'application. Il tourne dans un LXC Debian sur le même réseau
(`http://192.168.1.172:8100` chez l'opérateur), installé par une ligne.

- `server.py` — FastAPI. `create_app(agent)` prend l'agent en paramètre :
  testable sans torch avec un faux agent.
  - Au démarrage : `laya.load("convaiinnovations/laya", subfolder=<checkpoint>)`,
    `torch.set_num_threads(<threads>)`, une prédiction de chauffe dont la durée
    est retenue.
  - `GET /health` : `status`, `checkpoint`, `repo`, `device`, `threads`,
    `context_tokens`, `laya_version`, `torch_version`, `loaded_at`,
    `warmup_ms`, `predictions`, `latency_p50_ms`, `latency_p95_ms` (sur les 200
    dernières prédictions).
  - `POST /v1/systemone` : corps au dialecte Jev — `state`, `questions`
    (`{clé: {type, instructions, criteria}}`), `model` ignoré. Réponse :
    `model` (le checkpoint), `latency_ms`, `answers` (`choice`/`score`/`noul`,
    `confidence`, `probabilities` pour un choix, `distribution` pour une note),
    et `raw` : le dictionnaire rendu par `predict()` tel quel, pour qu'aucun
    champ inconnu ne soit perdu.
  - Clé facultative : `LAYA_API_KEY` non vide impose `Authorization: Bearer`.
    Vide par défaut — un réseau local.
  - Une exception de `predict()` est un 500 dont le `detail` est le message
    de l'exception. Un corps mal formé est un 422.
- `install.sh` — idempotent : `apt` (python3-venv, curl), venv `/opt/laya/venv`,
  torch CPU depuis l'index PyTorch, `laya fastapi uvicorn`, copie de
  `server.py` en `/opt/laya/`, `/etc/default/laya` (`LAYA_CHECKPOINT`,
  `LAYA_PORT`, `LAYA_THREADS`, `LAYA_API_KEY`), unité systemd `laya.service`,
  activation, attente de `/health`, impression de la carte.
- `README.md` — en français, pour l'opérateur : LXC conseillé (4–6 cœurs,
  8 Go, 24 Go), les trois checkpoints, comment changer de checkpoint, comment
  lire `/health`.
- `test_server.py` — pytest sur `create_app(FakeAgent())` : la forme des deux
  routes, la clé, le 500 nommé, les percentiles.

### 2. `decision/laya.py` — le fournisseur

Quatrième fournisseur, `PROVIDERS = ("local", "jev", "laya", "replay")`,
libellé « Laya (auto-hébergé) ». Même contrat, même parseur que Jev : un
choix hors options, une note hors échelle, une probabilité hors 0–1 sont
`OFF_CONTRACT`, jamais rapprochés.

Ce que le fournisseur emporte en plus :

- `Decision.mass_bps: dict[str, int] | None` — la masse par option (choix)
  ou par niveau (note, clés `"0"`…`"10"`), en points de base, parsée en
  `Decimal`. **Absente de `canonical()`** comme `confidence_bps` : elle décrit
  la sortie du modèle à ce run-là, pas la décision, et un rejeu ne doit pas
  différer parce qu'une distribution a bougé à la troisième décimale.
  `_decision_payload` l'écrit dans `answers` ; l'écran la lit là.
- `probe() -> dict` : `GET /health`, pour la route « Enregistrer et
  interroger ». Injoignable = `SERVICE_UNREACHABLE`, comme une décision.

Le corps de la question est le même que celui de Jev : `_questions_payload`
et les helpers `Decimal` quittent `jev.py` pour `decision/systemone.py`,
importés par les deux. Aucun changement de comportement pour Jev.

Registre : `provider == "laya"` exige `endpoint_url` (`NO_MODEL` sinon) ;
clé facultative. `local` et `jev` inchangés.

### 3. Le second avis

Quand le fournisseur configuré n'est pas `replay`, `trading/service.py`
interroge **aussi** le moteur déterministe sur le même `context`, dans le
même ordre (direction, puis conviction et continuation seulement si la
direction n'est pas « ne rien faire »), et range ses réponses canoniques
dans une nouvelle colonne `trade_decisions.second_opinion` (JSON, nullable).
Il n'exécute rien : le mandat ne voit que les réponses du fournisseur choisi.
Quand le fournisseur est `replay`, la colonne reste `NULL` — un moteur ne se
compare pas à lui-même.

Migration `c7d8e9f0a1b2` : ajoute la colonne, ne touche à rien d'autre.
`test_migrations.py` la joue en montée et en descente.

`engines/second_opinion.py` — pur : à partir de décisions (fournisseur,
réponses, second avis), rend `compared`, `agreed`, `agreement_bps`, et les
désaccords (les plus récents d'abord, jusqu'à 8) avec `decision_id`,
`symbol`, `model_choice`, `rules_choice`, `created_at`. Le désaccord se juge
sur `direction` seulement : c'est la réponse qui coûte de l'argent.

`GET /invest/overview` gagne `second_opinion` ; `GET /invest/decisions/{id}`
gagne `second_opinion` (les réponses canoniques du moteur, ou `null`).

### 4. Les écrans

- **Modèle de décision** : quatrième option « Laya (auto-hébergé) » avec
  l'adresse (`http://192.168.1.172:8100`), la clé (facultative), le délai.
  Pas de champ « checkpoint » : c'est le serveur qui le sait, et la carte de
  santé le dit. Après « Enregistrer et interroger », une **carte de santé** :
  checkpoint, device, threads, contexte, chauffe, p50/p95, nombre de
  prédictions, et la réponse de test **avec sa masse par option**.
  `DecisionModelCheckOut` gagne `health: dict | None` et `mass_bps`.
- **Décisions → dépliage** : sous chaque question, quand `mass_bps` existe,
  une rangée de barres — une par option ou par niveau — avec le pourcentage
  en `.yd-num`, l'option retenue marquée par la coche, jamais par la couleur
  seule. Pour la probabilité : deux barres, « se poursuit » / « s'inverse ».
  À côté, quand `second_opinion` existe : « Les règles auraient dit :
  ne rien faire » en pastille, accordée ou en désaccord.
- **Salle de contrôle** : panneau « Le modèle contre les règles » —
  `agreement_bps` en grand, `compared` en sous-titre, la liste des désaccords
  récents (instrument, modèle, règles, heure, lien vers la décision). Vide :
  un `EmptyState` disant que le second avis n'est tenu que lorsqu'un modèle
  autre que le moteur intégré est configuré.

Tout en français, chiffres en `.yd-num`, aucune couleur seule, aucun hex
dans un composant, 1440 et 390, clair et sombre, jugé en navigateur avant
d'être déclaré fait.

### 5. Ce qui ne bouge pas

Le mandat, le dimensionnement, les courtiers, le journal scellé, le rejeu.
`canonical()` ne change pas, donc les empreintes existantes restent
vérifiables. Aucune température : elle viendra quand la calibration aura
assez de points pour en dire une.

## Tests

- `tools/laya-server/test_server.py` — sans torch.
- `tests/test_laya_provider.py` — `httpx.post` remplacé : réponse conforme,
  masse parsée en points de base, choix hors options refusé, clé absente
  acceptée, délai dépassé, 401, santé.
- `tests/test_second_opinion.py` — le moteur pur ; `test_trading_pipeline.py`
  : la colonne remplie avec un fournisseur, `NULL` avec `replay`.
- `tests/test_invest_api.py` — `PUT /invest/model` avec `laya` (adresse
  exigée, santé rendue), `overview.second_opinion`, détail avec
  `second_opinion`.
- `tests/test_migrations.py` — la colonne monte et descend.
- Front : `ModelPage.test.tsx` (l'option, la carte de santé),
  `DecisionDetail.test.tsx` (les barres, la coche, la pastille du second
  avis), `ControlRoomPage.test.tsx` (le panneau, son état vide).
