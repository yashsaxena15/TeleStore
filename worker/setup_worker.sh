#!/usr/bin/env bash
# ==============================================================================
# TelegramFileServer - Distributed Worker Auto-Installer
# Runs on any remote VPS (Ubuntu / Debian) to instantly join the cluster
# ==============================================================================
set -e

echo "=== TelegramFileServer Distributed Worker Setup ==="

# Check arguments or prompt
MASTER_URL="${1:-}"
WORKER_KEY="${2:-}"
WORKER_ID="${3:-$(hostname)}"

if [ -z "$MASTER_URL" ]; then
    read -p "Enter Master URL (e.g., https://telegram.yourdomain.com): " MASTER_URL
fi

if [ -z "$WORKER_KEY" ]; then
    read -p "Enter WORKER_SECRET_KEY from Master .env: " WORKER_KEY
fi

if [ -z "$MASTER_URL" ] || [ -z "$WORKER_KEY" ]; then
    echo "Error: Both MASTER_URL and WORKER_KEY are required!"
    exit 1
fi

TARGET_USER="${SUDO_USER:-$USER}"
TARGET_DIR="/home/$TARGET_USER/tele_worker"

echo "[1/4] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-pip python3-venv git curl

echo "[2/4] Setting up worker environment at $TARGET_DIR..."
sudo -u "$TARGET_USER" mkdir -p "$TARGET_DIR/cache"
sudo -u "$TARGET_USER" python3 -m venv "$TARGET_DIR/venv"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/worker.py" ]; then
    sudo -u "$TARGET_USER" cp "$SCRIPT_DIR/worker.py" "$TARGET_DIR/worker.py"
    sudo -u "$TARGET_USER" cp "$SCRIPT_DIR/requirements.txt" "$TARGET_DIR/requirements.txt"
fi

echo "[3/4] Installing Python dependencies in venv..."
sudo -u "$TARGET_USER" "$TARGET_DIR/venv/bin/pip" install --upgrade pip -q
sudo -u "$TARGET_USER" "$TARGET_DIR/venv/bin/pip" install -r "$TARGET_DIR/requirements.txt" -q

echo "[4/4] Creating systemd service..."
cat <<EOF | sudo tee /etc/tele_worker.env > /dev/null
MASTER_URL=$MASTER_URL
WORKER_KEY=$WORKER_KEY
WORKER_ID=$WORKER_ID
WORK_DIR=$TARGET_DIR/cache
EOF
sudo chmod 600 /etc/tele_worker.env

cat <<EOF | sudo tee /etc/systemd/system/tele_worker.service > /dev/null
[Unit]
Description=TelegramFileServer Distributed Leech Worker ($WORKER_ID)
After=network.target

[Service]
Type=simple
User=$TARGET_USER
WorkingDirectory=$TARGET_DIR
EnvironmentFile=/etc/tele_worker.env
ExecStart=$TARGET_DIR/venv/bin/python3 $TARGET_DIR/worker.py
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tele_worker
sudo systemctl restart tele_worker

echo ""
echo "=== Setup Complete! ==="
echo "Worker '$WORKER_ID' is now active and connected to Master: $MASTER_URL"
echo "Check logs anytime with: sudo journalctl -u tele_worker -f"

