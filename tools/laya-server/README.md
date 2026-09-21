# Laya pour Yieldo

Le serveur qui met Laya derrière le pilote de l'environnement Investissement.

## Ce que c'est, et ce que ce n'est pas

Laya (`convaiinnovations/laya`, Apache 2.0) est un **encodeur** — ModernBERT-large
plus une tête de décision, 421 M de paramètres — qui répond aux trois formes
typées du pilotage : un choix parmi des options, une note sur une échelle, une
probabilité. Il ne génère pas de texte. Il rend en plus la masse de probabilité
par option et par niveau, et la probabilité d'agir de sa tête act/escalate.

Ce n'est **pas un LLM** : ni vLLM, ni llama.cpp, ni Ollama ne peuvent le servir.
Il ne tourne que par son paquet Python (PyTorch, CPU accepté). Ce dossier est
le serveur HTTP qui lui manque, dans le dialecte que Yieldo parle déjà.

## La machine

Un LXC Debian (12 ou 13), sans privilège :

| Réglage | Valeur | Pourquoi |
|---|---|---|
| CPU | 4 cœurs, 6–10 si possible | torch parallélise ; la latence suit le nombre de cœurs |
| RAM | 8 Go | 1,7 Go de poids, 3–4 Go résidents en marche |
| Disque | 24 Go | torch CPU ≈ 1,2 Go, chaque checkpoint ≈ 1,7 Go |
| Réseau | IP fixe, port 8100 joignable depuis Yieldo | |

Mesuré sur 10 cœurs : **≈ 650 ms par question**. Yieldo pose une question par
appel et n'en pose que trois par instrument ; un « ne rien faire » n'en coûte
qu'une.

## Installation

En root, dans le conteneur :

```bash
curl -fsSL https://raw.githubusercontent.com/Ezoxe/Yieldo/master/tools/laya-server/install.sh | bash
```

Le script pose un venv dans `/opt/laya`, installe torch CPU et `laya`, écrit
`/etc/default/laya`, active le service systemd `laya` et attend que
`/health` réponde. Le relancer met à jour `server.py` et les paquets sans
toucher à la configuration.

Puis, dans Yieldo : Investissement → Modèle de décision → « Laya
(auto-hébergé) », adresse `http://<ip du conteneur>:8100`, « Enregistrer et
interroger ». La carte de santé s'affiche avec la réponse de test et sa
distribution.

## Configuration : `/etc/default/laya`

| Clé | Défaut | Rôle |
|---|---|---|
| `LAYA_CHECKPOINT` | `multilingual` | `multilingual`, `base` ou `typed-decisions` |
| `LAYA_PORT` | `8100` | le port servi |
| `LAYA_THREADS` | `nproc` | threads torch |
| `LAYA_API_KEY` | vide | si renseignée, Yieldo doit envoyer la même clé |

Après modification : `systemctl restart laya`. Un changement de checkpoint
télécharge le nouveau (≈ 1,7 Go) au redémarrage.

## Lire `/health`

```bash
curl -s http://127.0.0.1:8100/health
```

`checkpoint`, `device`, `threads`, `context_tokens`, `temperatures` (celles
livrées avec le checkpoint), `warmup_ms` (la première prédiction),
`predictions`, `latency_p50_ms`, `latency_p95_ms` sur les 200 dernières.
Journal : `journalctl -u laya -f`.

## Ce qu'il faut savoir avant de lui faire confiance

- **Surconfiance à la sortie de la boîte** (ECE 0,466 avant recalibrage,
  d'après ses auteurs). Le panneau « Le modèle dit-il vrai ? » de la Salle de
  contrôle le mesure sur vos propres décisions.
- **Zero-shot proche du hasard** sur les décisions typées pour les checkpoints
  de base ; `typed-decisions` a été affiné sur des flux métier anglais, pas
  sur des séries de prix. Mesuré le 2026-09-21 sur une journée simulée de
  78 pas : avec `typed-decisions`, la masse reste figée (≈ 20 / 30 / 50 %)
  et le modèle ne fait rien ; avec `multilingual` — l'état que Yieldo envoie
  est en français — la masse suit le marché (acheter de 4 à 74 %) et des
  ordres partent. D'où le défaut. Le panneau « Le modèle contre les règles »
  compare chaque décision de Laya au moteur déterministe intégré, jamais
  exécuté : c'est là que se lit s'il bat quatre règles de momentum.
