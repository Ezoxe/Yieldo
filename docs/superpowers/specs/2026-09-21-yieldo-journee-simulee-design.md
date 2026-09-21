# La journée simulée — 78 pas de marché synthétique, un modèle, un bilan

Date : 2026-09-21. Suite du chantier Laya (`2026-09-21-yieldo-laya-design.md`).

## Pourquoi

Un tour à la fois ne dit rien : trois « ne rien faire » et un capital qui ne
bouge pas. La question de l'opérateur est « Laya fait-elle du profit ? », et
elle ne se pose que sur une séance entière. Le marché synthétique du bac à
sable est déterministe par `(instrument, index)` : une **journée** est 78 pas
consécutifs (une séance de 6 h 30 à 5 min) depuis un index tiré au sort, et le
même numéro rejoue exactement les mêmes cours — la comparaison Laya / règles /
autre mandat se fait sur la même journée.

## La journée, côté serveur

- **Table `trading_sessions`** : `user_id`, `venue_id`, `mode` (`paper`
  seulement), `seed` (index de départ), `steps` (78 par défaut, 12–240),
  `interval_minutes` (5), `status` (`running`, `finished`, `stopped`,
  `failed`), `stop_requested`, `provider`, `model`, `initial_cash_cents`,
  `final_equity_cents`, `realised_pnl_cents`, `unrealised_pnl_cents`,
  `max_drawdown_bps`, `orders`, `decisions`, `completed_steps`, `message`,
  `points` (JSON : un point par pas — `step`, `equity_cents`, `cash_cents`,
  `exposure_cents`, `orders`), `started_at`, `finished_at`.
- **`trade_decisions.session_id`** (nullable, FK) et **`session_step`**
  (nullable) : chaque décision d'une journée sait à quel pas elle appartient.
- **Migration `d8e9f0a1b2c3`** : la table et les deux colonnes, rien d'autre.
- **`trading/session.py`** — `run_session(db, user, session_id, provider)` :
  1. remet le bac à sable au montant choisi (même effet que
     `POST /invest/sandbox/reset`), pose `venue.sandbox_step = seed` ;
  2. pour chaque pas : `service.run_cycle(...)` (qui avance le marché d'un
     pas), rattache les décisions du tour à la journée, calcule le capital aux
     cours du pas, ajoute le point, met à jour `completed_steps`, commit ;
     s'arrête si `stop_requested` ;
  3. à la fin : `final_equity_cents`, `realised_pnl_cents`,
     `unrealised_pnl_cents`, `max_drawdown_bps`, `status`, `finished_at`,
     et une entrée de journal `session_finished`.
  Une `DecisionError` ou une `VenueError` pendant la boucle termine la journée
  en `failed` avec la phrase française de la cause dans `message` — jamais un
  crash silencieux de la tâche de fond.
- **Tâche de fond** : `BackgroundTasks` de FastAPI, avec sa propre
  `SessionLocal()`. Une seule journée `running` par foyer (409 sinon).
- **Les cours ne sont pas stockés** : `sandbox.closes(symbol, end_index=seed+n,
  count=n)` est pur ; la route de détail les recalcule.
- **`engines/session_report.py`** (pur) : à partir des points, des décisions
  et des ordres — `return_bps`, `max_drawdown_bps`, `orders`, `winning`,
  `losing`, `realised_pnl_cents`, `held`/`refused`/`ordered`/`failed`,
  `agreement_bps` avec les règles, `mean_confidence_bps`, `mean_act_bps`,
  `latency_p50_ms`, et par instrument la série `direction_mass` (pas → masse
  acheter/vendre/ne rien faire) pour le graphique « ce que Laya a dit ».
- **Routes** (`api/invest_session.py`, `get_session_user` pour créer et
  arrêter, `get_current_user` pour lire) :
  `POST /invest/sessions` `{steps?, seed?, cash_cents?}` → 202 + la journée ;
  `GET /invest/sessions` (les 20 dernières) ; `GET /invest/sessions/{id}` →
  la journée, ses points, les cours par instrument, les décisions (résumé +
  masse), les ordres, le bilan ; `POST /invest/sessions/{id}/stop`.
- Journal : `session_started` et `session_finished` rejoignent
  `AUDIT_KINDS` (le front en porte le libellé).

## L'écran « La journée » — `/invest/journee`

Nouvelle entrée de `LE PILOTAGE`, alias « séance », « simulation », « journée ».

- **Lancer** : montant de départ, seed facultatif (« rejouer la journée
  n° … »), pas (78), « Lancer la journée ». Pendant l'exécution : barre
  `completed_steps / steps`, temps restant estimé sur le rythme mesuré,
  « Arrêter », rafraîchissement toutes les 2 s.
- **Le capital** : courbe capital et liquidités sur les pas (ECharts,
  `charts/Chart.tsx`), marqueurs d'ordres.
- **Le marché** : un graphique par instrument — cours synthétique, marqueurs
  achat / vente, points « ne rien faire » ; survol : le choix, la masse, la
  conviction, la latence à ce pas.
- **Ce que le modèle a dit** : par instrument, barres empilées
  acheter / vendre / ne rien faire pas par pas — la masse dans le temps.
- **Le bilan** : rendement, drawdown max, ordres (gagnants / perdants), P&L
  réalisé et latent, accord avec les règles, confiance et « agir » moyens,
  latence p50, entonnoir des issues (`PipelineFunnel`).
- **Journées précédentes** : seed, modèle, rendement, statut ; « Rejouer
  cette journée » pré-remplit le seed.
- **Salle de contrôle** : bouton « Simuler une journée » vers l'écran.

Tout en français, chiffres en `.yd-num`, couleurs par jetons, 1440 et 390,
clair et sombre, jugé en navigateur.

## Ce qui ne bouge pas

Le mandat, le dimensionnement, le journal scellé, le second avis : une
journée est une suite de tours ordinaires. Un tour lancé à la main pendant
une journée en cours est refusé (409) — deux mains sur le même carnet.

## Tests

- `tests/test_session_report.py` — le moteur pur.
- `tests/test_trading_session.py` — `run_session` avec `ReplayProvider` sur
  8 pas : les points, le rattachement des décisions, l'arrêt, l'échec nommé.
- `tests/test_invest_session_api.py` — création (202, seed tiré, 409 si une
  journée court), lecture (cours recalculés, bilan), arrêt, isolation entre
  foyers, clé d'agent refusée à la création.
- `tests/test_migrations.py` — la table et les colonnes, montée et descente.
- Front : `SessionPage.test.tsx` (formulaire, progression, bilan, journées
  précédentes), `SessionCharts.test.tsx` (les options ECharts : séries et
  marqueurs à partir d'une journée), `navigation.test.ts` (l'entrée).
