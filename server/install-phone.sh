#!/usr/bin/env bash
# ============================================================================
# nashat-vpn — install-phone.sh  (Termux / Linux / WSL)
# Turns an old Android phone (Termux) or any Linux box into a Nashat VPN
# "Fast tier" server — NO card, NO cloud account, NO public IP needed.
#
#   bash install-phone.sh
#
# How it works:
#   1. Installs Xray (VLESS + WebSocket on localhost) and cloudflared.
#   2. cloudflared opens a FREE public HTTPS tunnel (Cloudflare) to the phone —
#      this is what makes it reachable even behind Iraqi CGNAT/no public IP,
#      and the traffic looks like ordinary web browsing to the ISP.
#   3. Prints your personal vless:// link → paste it to Nashat (send to Nashat).
#
# Requirements: Termux from F-Droid (Android 8+), or any Debian-ish Linux.
# ============================================================================
set -euo pipefail

echo "── nashat-vpn phone server installer ──"

# 1. packages -----------------------------------------------------------------
if command -v apt >/dev/null 2>&1; then
  apt update -y >/dev/null 2>&1 || pkg update -y >/dev/null 2>&1 || true
  apt install -y curl unzip openssl jq >/dev/null 2>&1 || pkg install -y curl unzip openssl jq >/dev/null 2>&1 || true
fi

ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64) XRAY_ARCH=arm64-v8a; CF_ARCH=arm64 ;;
  armv7*|armv8*) XRAY_ARCH=arm32-v7a; CF_ARCH=arm ;;
  x86_64)        XRAY_ARCH=64;        CF_ARCH=amd64 ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac

WORK=$HOME/.nashat-vpn-server
mkdir -p "$WORK"
cd "$WORK"

# 2. Xray ---------------------------------------------------------------------
if [ ! -x xray/xray ]; then
  echo "→ downloading Xray ($XRAY_ARCH)…"
  curl -sL -o xray.zip "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${XRAY_ARCH}.zip"
  mkdir -p xray && unzip -o -q xray.zip -d xray && rm xray.zip
fi

# 3. credentials ----------------------------------------------------------------
UUID=$(./xray/xray uuid)
WS_PATH=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
echo "→ UUID: $UUID   WS path: /$WS_PATH"

cat > xray/config.json <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [{
    "listen": "127.0.0.1",
    "port": 8080,
    "protocol": "vless",
    "settings": { "clients": [{ "id": "$UUID" }], "decryption": "none" },
    "streamSettings": { "network": "ws", "wsSettings": { "path": "/$WS_PATH" } }
  }],
  "outbounds": [{ "protocol": "freedom" }]
}
EOF

# 4. cloudflared ----------------------------------------------------------------
if [ ! -x cloudflared ]; then
  echo "→ downloading cloudflared ($CF_ARCH)…"
  curl -sL -o cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
  chmod +x cloudflared
fi

# 5. start both ------------------------------------------------------------------
pkill -f "xray/xray run" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
nohup ./xray/xray run -c xray/config.json > xray.log 2>&1 &
sleep 1
nohup ./cloudflared tunnel --url http://127.0.0.1:8080 --no-autoupdate > tunnel.log 2>&1 &

echo "→ waiting for Cloudflare to assign your free public address…"
HOST=""
for i in $(seq 1 40); do
  HOST=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tunnel.log | head -1 | sed 's#https://##')
  [ -n "$HOST" ] && break
  sleep 2
done
[ -n "$HOST" ] || { echo "tunnel failed — see $WORK/tunnel.log"; exit 1; }

LINK="vless://${UUID}@${HOST}:443?type=ws&encryption=none&host=${HOST}&path=%2F${WS_PATH}&security=tls&sni=${HOST}&fp=chrome#Nashat-Phone-${HOST%%.*}"

echo
echo "============================================================"
echo " ✔ PHONE SERVER IS LIVE"
echo "   public: $HOST  (free Cloudflare tunnel, TLS on 443)"
echo "============================================================"
echo "$LINK"
echo
echo "Send this link to Nashat → it becomes a ⭐ Fast country in the app."
echo "$LINK" > "$WORK/my-link.txt"
echo "(saved to $WORK/my-link.txt — keep the Termux session running!)"
