#!/usr/bin/env bash
# Yieldo — installer and lifecycle manager.
# Usage: ./install.sh [install|update|backup|restore <file>|start|stop|restart|logs|status|uninstall]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$REPO_ROOT/.env"
DATA_DIR="$REPO_ROOT/data"
BACKUP_DIR="$DATA_DIR/backups"
DB_FILE="$DATA_DIR/yieldo.db"
DEFAULT_PORT=8080
KEEP_BACKUPS=10

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { printf "${BLUE}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# ── Utilities (sourced by the test harness) ─────────────────────────────

# Picks a Python interpreter that actually runs, not just one that is on
# PATH. On some Windows installs "python3" is a WindowsApps shim that only
# opens the Microsoft Store and exits non-zero instead of executing any
# code — `command -v python3` still finds it, so that check alone is not
# enough. Debian ships a real python3, so this resolves to python3 there;
# it only falls back to `python` where python3 is present-but-broken.
python_bin() {
  if command -v python3 >/dev/null 2>&1 && python3 --version >/dev/null 2>&1; then
    printf 'python3'
  elif command -v python >/dev/null 2>&1 && python --version >/dev/null 2>&1; then
    printf 'python'
  fi
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tuln 2>/dev/null | awk '{print $5}' | grep -qE "[:.]${port}\$" && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tuln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$" && return 0
  fi
  # Last resort: ask Python to check. A plain bind() is not sufficient on
  # every platform — on Windows, binding a fresh socket to 0.0.0.0:<port>
  # can succeed even while another process already listens on
  # 127.0.0.1:<port> (Windows does not reject the second bind the way
  # Linux does), which would under-report an occupied port. Try an actual
  # connect() first to catch a listening service, then fall back to bind().
  local py; py="$(python_bin)"
  if [ -n "$py" ]; then
    "$py" - "$port" <<'PY' && return 1 || return 0
import socket, sys
port = int(sys.argv[1])

c = socket.socket()
c.settimeout(0.3)
try:
    c.connect(("127.0.0.1", port))
    c.close()
    sys.exit(1)  # something accepted the connection: port is in use
except OSError:
    c.close()

s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("0.0.0.0", port))
except OSError:
    sys.exit(1)  # bind refused: port is in use
finally:
    s.close()
PY
  fi
  return 1
}

find_free_port() {
  local candidate="${1:-$DEFAULT_PORT}"
  local attempts=0
  while [ "$attempts" -lt 200 ]; do
    if ! port_in_use "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
    attempts=$((attempts + 1))
  done
  fail "Aucun port libre trouvé à partir de ${1:-$DEFAULT_PORT}."
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    fail "Impossible de générer une clé secrète : ni openssl ni /dev/urandom."
  fi
}

read_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || { printf ''; return 0; }
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$ENV_FILE" "$@"
  else
    docker-compose --env-file "$ENV_FILE" "$@"
  fi
}

# When sourced by tests, stop here: define functions, run nothing.
if [ "${YIELDO_LIB_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

# ── Preflight ───────────────────────────────────────────────────────────

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || fail "Docker n'est pas installé. Voir https://docs.docker.com/engine/install/debian/"
  docker info >/dev/null 2>&1 \
    || fail "Le démon Docker ne répond pas. Démarrez-le, ou ajoutez votre utilisateur au groupe docker."
  docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 \
    || fail "Docker Compose est introuvable. Installez le plugin docker-compose-plugin."
}

ensure_env() {
  mkdir -p "$DATA_DIR" "$BACKUP_DIR"

  # Read every value we intend to preserve BEFORE writing: the heredoc below
  # truncates $ENV_FILE, so any read inside it would come back empty.
  local port secret registration
  registration=true
  if [ -f "$ENV_FILE" ]; then
    port="$(read_env_value "$ENV_FILE" YIELDO_PORT)"
    secret="$(read_env_value "$ENV_FILE" YIELDO_SECRET_KEY)"
    local stored_registration
    stored_registration="$(read_env_value "$ENV_FILE" YIELDO_REGISTRATION_OPEN)"
    [ -n "$stored_registration" ] && registration="$stored_registration"
  fi

  if [ -z "${port:-}" ]; then
    port="$(find_free_port "${YIELDO_PORT:-$DEFAULT_PORT}")"
    info "Port retenu : $port"
  elif port_in_use "$port" && ! compose ps --status running 2>/dev/null | grep -q yieldo; then
    warn "Le port $port est occupé par un autre service. Recherche d'un port libre…"
    port="$(find_free_port "$((port + 1))")"
    info "Nouveau port : $port"
  fi

  # The secret is generated exactly once. Regenerating it would make every
  # stored API key unreadable and log everyone out.
  if [ -z "${secret:-}" ]; then
    secret="$(generate_secret)"
    info "Clé secrète générée."
  fi

  cat > "$ENV_FILE" <<EOF
# Généré par install.sh — ne pas versionner
YIELDO_PORT=$port
YIELDO_SECRET_KEY=$secret
YIELDO_REGISTRATION_OPEN=$registration
YIELDO_ACCESS_TOKEN_MINUTES=30
YIELDO_REFRESH_TOKEN_DAYS=30
YIELDO_CONTAINER_NAME=yieldo
EOF
  chmod 600 "$ENV_FILE"
}

wait_for_health() {
  local port="$1" attempts=0
  info "Attente du démarrage…"
  while [ "$attempts" -lt 60 ]; do
    if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    attempts=$((attempts + 1))
  done
  return 1
}

# ── Commands ────────────────────────────────────────────────────────────

cmd_install() {
  require_docker
  ensure_env
  local port; port="$(read_env_value "$ENV_FILE" YIELDO_PORT)"

  info "Construction de l'image…"
  compose build
  info "Démarrage…"
  compose up -d

  if wait_for_health "$port"; then
    ok "Yieldo est accessible sur http://localhost:$port"
    ok "Le premier compte créé sera administrateur."
    warn "Sauvegardez $ENV_FILE : sa clé chiffre vos clés d'API."
  else
    fail "Yieldo n'a pas répondu. Diagnostic : ./install.sh logs"
  fi
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  [ -f "$DB_FILE" ] || { warn "Aucune base à sauvegarder."; return 0; }

  local stamp archive
  stamp="$(date +%Y%m%d-%H%M%S)"
  archive="$BACKUP_DIR/yieldo-$stamp.db"

  # sqlite3 .backup is consistent on a live database; plain cp is not.
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_FILE" ".backup '$archive'"
  else
    compose exec -T yieldo sh -c "sqlite3 /app/data/yieldo.db \".backup '/app/data/backups/yieldo-$stamp.db'\"" \
      || cp "$DB_FILE" "$archive"
  fi

  cp "$ENV_FILE" "$BACKUP_DIR/env-$stamp.bak" 2>/dev/null || true
  ok "Sauvegarde : $archive"

  ls -1t "$BACKUP_DIR"/yieldo-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) \
    | xargs -r rm -f
  printf '%s' "$archive"
}

cmd_update() {
  require_docker
  [ -f "$ENV_FILE" ] || fail "Yieldo n'est pas installé. Lancez ./install.sh install"

  local archive port
  archive="$(cmd_backup | tail -n1)"
  port="$(read_env_value "$ENV_FILE" YIELDO_PORT)"

  if [ -d "$REPO_ROOT/.git" ]; then
    info "Récupération de la dernière version…"
    git -C "$REPO_ROOT" pull --ff-only || warn "git pull impossible — poursuite avec le code local."
  fi

  info "Reconstruction…"
  compose build
  compose up -d   # migrations run in the entrypoint

  if wait_for_health "$port"; then
    ok "Mise à jour terminée. http://localhost:$port"
  else
    warn "La nouvelle version ne répond pas — restauration de la sauvegarde."
    compose down
    [ -n "$archive" ] && [ -f "$archive" ] && cp "$archive" "$DB_FILE"
    compose up -d
    fail "Mise à jour annulée, données restaurées. Diagnostic : ./install.sh logs"
  fi
}

cmd_restore() {
  local archive="${1:-}"
  [ -n "$archive" ] && [ -f "$archive" ] || fail "Usage : ./install.sh restore <fichier.db>"
  warn "Cette opération remplace la base actuelle par $archive."
  printf "Confirmer ? [oui/NON] "
  read -r answer
  [ "$answer" = "oui" ] || { info "Annulé."; return 0; }

  cmd_backup >/dev/null
  compose down
  cp "$archive" "$DB_FILE"
  compose up -d
  ok "Base restaurée."
}

cmd_uninstall() {
  warn "Le container va être supprimé. Le dossier data/ est CONSERVÉ."
  printf "Confirmer ? [oui/NON] "
  read -r answer
  [ "$answer" = "oui" ] || { info "Annulé."; return 0; }
  compose down --rmi local
  ok "Container supprimé. Vos données restent dans $DATA_DIR"
}

usage() {
  cat <<'EOF'
Yieldo — gestion du cycle de vie

  ./install.sh install          Installe et démarre (port libre détecté automatiquement)
  ./install.sh update           Sauvegarde, met à jour, migre, restaure si échec
  ./install.sh backup           Sauvegarde horodatée de la base
  ./install.sh restore <fic>    Restaure une sauvegarde
  ./install.sh start|stop|restart
  ./install.sh logs             Journaux en continu
  ./install.sh status           État du service
  ./install.sh uninstall        Supprime le container, conserve les données
EOF
}

case "${1:-help}" in
  install)   cmd_install ;;
  update)    cmd_update ;;
  backup)    cmd_backup >/dev/null ;;
  restore)   cmd_restore "${2:-}" ;;
  start)     require_docker; compose up -d; ok "Démarré." ;;
  stop)      compose down; ok "Arrêté." ;;
  restart)   compose restart; ok "Redémarré." ;;
  logs)      compose logs -f --tail=200 ;;
  status)    compose ps ;;
  uninstall) cmd_uninstall ;;
  help|--help|-h) usage ;;
  *)         usage; exit 1 ;;
esac
