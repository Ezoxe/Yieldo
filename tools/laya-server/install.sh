#!/usr/bin/env bash
# Installs or updates the Laya server for Yieldo on a Debian/Ubuntu host
# (a Proxmox LXC, typically). Idempotent: run it again to update server.py
# or the packages; /etc/default/laya is written once and then left alone.
#
#   curl -fsSL https://raw.githubusercontent.com/Ezoxe/Yieldo/master/tools/laya-server/install.sh | bash
set -euo pipefail

RAW="https://raw.githubusercontent.com/Ezoxe/Yieldo/master/tools/laya-server"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo /nonexistent)"
PORT="${LAYA_PORT:-8100}"

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root." >&2; exit 1; }

echo "== Paquets système"
apt-get update -qq
apt-get install -y -qq python3 python3-venv curl >/dev/null

echo "== Environnement Python (/opt/laya/venv)"
mkdir -p /opt/laya
[ -x /opt/laya/venv/bin/python ] || python3 -m venv /opt/laya/venv
/opt/laya/venv/bin/pip install -q --upgrade pip
/opt/laya/venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cpu
/opt/laya/venv/bin/pip install -q "laya>=0.3.4" "fastapi>=0.115" "uvicorn[standard]>=0.30"

fetch() {  # copies from the checkout when run from it, downloads otherwise
  if [ -f "$HERE/$1" ]; then cp "$HERE/$1" "$2"; else curl -fsSL "$RAW/$1" -o "$2"; fi
}
echo "== Serveur"
fetch server.py /opt/laya/server.py
fetch laya.service /etc/systemd/system/laya.service

if [ ! -f /etc/default/laya ]; then
  cat > /etc/default/laya <<CONF
# Laya pour Yieldo. Après modification : systemctl restart laya
# Checkpoint : typed-decisions (défaut), base ou multilingual.
LAYA_CHECKPOINT=typed-decisions
LAYA_PORT=$PORT
LAYA_THREADS=$(nproc)
# Vide = pas de clé (réseau local). Sinon Yieldo doit envoyer la même.
LAYA_API_KEY=
CONF
fi
# shellcheck disable=SC1091
. /etc/default/laya
PORT="${LAYA_PORT:-$PORT}"

systemctl daemon-reload
systemctl enable laya.service >/dev/null
systemctl restart laya.service

echo "== Chargement du modèle (le premier démarrage télécharge ~1,7 Go)"
for _ in $(seq 1 180); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$PORT/health"; echo
    echo "Laya répond sur le port $PORT. Journal : journalctl -u laya -f"
    exit 0
  fi
  sleep 2
done
echo "Laya n'a pas répondu en six minutes : journalctl -u laya -e" >&2
exit 1
