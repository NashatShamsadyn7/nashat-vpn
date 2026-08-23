#!/usr/bin/env bash
# ============================================================================
# nashat-vpn — one-shot server installer
# Xray VLESS + REALITY (xtls-rprx-vision) on a fresh Ubuntu 22.04/24.04 VPS.
#
#   sudo bash install.sh [email] [sni-host]
#   sudo bash install.sh me@example.com www.microsoft.com
#
# What it does: hardens the box (ufw + fail2ban), installs Xray from the
# official release, generates fresh UUID / x25519 keys / shortId, writes a
# REALITY config on port 443, starts the service, and prints your personal
# vless:// share link (plus a QR code) ready to import into nashat-vpn.
# ============================================================================
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0"; exit 1; }
EMAIL="${1:-admin@nashat.local}"
SNI="${2:-www.microsoft.com}"
XRAY_CONF=/usr/local/etc/xray/config.json

echo "==> [1/6] System update + packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl unzip qrencode ufw fail2ban openssl jq

echo "==> [2/6] Firewall (SSH + 443 only) + fail2ban"
ufw allow OpenSSH >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable
systemctl enable --now fail2ban >/dev/null 2>&1 || true

echo "==> [3/6] Installing Xray (official installer)"
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install

echo "==> [4/6] Generating credentials"
UUID=$(/usr/local/bin/xray uuid)
KEYS=$(/usr/local/bin/xray x25519)
PRIVATE_KEY=$(echo "$KEYS" | jq -r '."Private key:" // empty' 2>/dev/null || echo "$KEYS" | grep -i 'private' | awk '{print $NF}')
PUBLIC_KEY=$(echo "$KEYS"  | jq -r '."Public key:"  // empty' 2>/dev/null || echo "$KEYS" | grep -i 'public'  | awk '{print $NF}')
SHORT_ID=$(openssl rand -hex 4)

echo "==> [5/6] Writing REALITY config (port 443, dest $SNI)"
mkdir -p "$(dirname "$XRAY_CONF")"
cat > "$XRAY_CONF" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "clients": [
          { "id": "$UUID", "email": "$EMAIL", "flow": "xtls-rprx-vision" }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "$SNI:443",
          "xver": 0,
          "serverNames": ["$SNI"],
          "privateKey": "$PRIVATE_KEY",
          "shortIds": ["$SHORT_ID"]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ]
}
EOF

systemctl restart xray
systemctl enable xray >/dev/null

echo "==> [6/6] Verifying service"
sleep 1
systemctl is-active --quiet xray || { journalctl -u xray -n 30 --no-pager; exit 1; }

SERVER_IP=$(curl -s4 https://api.ipify.org || curl -s4 ifconfig.me)
LINK="vless://${UUID}@${SERVER_IP}:443?type=tcp&security=reality&fp=chrome&sni=${SNI}&sid=${SHORT_ID}&pbk=${PUBLIC_KEY}&flow=xtls-rprx-vision#NashatVPN-${SERVER_IP}"

{
  echo "nashat-vpn server installed $(date -u +%FT%TZ)"
  echo "SNI/dest : $SNI"
  echo "Link     : $LINK"
  echo "Keep this file private — it is your VPN key."
} > /root/nashat-vpn-link.txt
chmod 600 /root/nashat-vpn-link.txt

echo
echo "============================================================"
echo " ✔ Xray REALITY is live on port 443"
echo "============================================================"
echo "$LINK"
echo
qrencode -t ANSIUTF8 "$LINK" || true
echo "Saved to /root/nashat-vpn-link.txt (chmod 600)."
echo "Import this link on your PC:  node cli/vpn.js import \"<link>\""
