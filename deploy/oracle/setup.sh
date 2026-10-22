#!/usr/bin/env bash
# RagaStream API on an Oracle Cloud "Always Free" Ubuntu VM (Ampere/ARM or x86).
# Run on the VM:   curl -fsSL https://raw.githubusercontent.com/05Atharva/RagaStream/main/deploy/oracle/setup.sh | bash
# Safe to re-run: it updates the code and restarts. See docs/DEPLOY.md ("Oracle Cloud").
set -euo pipefail

REPO="https://github.com/05Atharva/RagaStream.git"
DIR="/opt/ragastream"
KIT="$DIR/deploy/oracle"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "1/6 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo systemctl enable --now docker

say "2/6 Firewall: open 80 and 443 (Oracle's Ubuntu images only allow SSH)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save >/dev/null
else
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
  sudo netfilter-persistent save >/dev/null
fi

say "3/6 Code"
sudo apt-get install -y git >/dev/null 2>&1 || true
if [ -d "$DIR/.git" ]; then
  sudo git -C "$DIR" pull --ff-only
else
  sudo git clone --depth 1 "$REPO" "$DIR"
fi
sudo chown -R "$USER" "$DIR"

say "4/6 Address"
IP="$(curl -fsS https://api.ipify.org)"
DOMAIN="${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"
echo "Public IP: $IP"
echo "HTTPS address: https://$DOMAIN"

say "5/6 Settings (stored in $KIT/.env, readable only by you)"
if [ ! -f "$KIT/.env" ]; then
  read -rp  "SUPABASE_URL (https://....supabase.co): " SUPABASE_URL </dev/tty
  read -rsp "SUPABASE_KEY (anon key, hidden): " SUPABASE_KEY </dev/tty; echo
  read -rsp "SUPABASE_SERVICE_ROLE_KEY (service_role, hidden): " SUPABASE_SERVICE_ROLE_KEY </dev/tty; echo
  read -rp  "OWNER_EMAILS [atharvakanawade@gmail.com]: " OWNER_EMAILS </dev/tty
  umask 077
  cat > "$KIT/.env" <<EOF
DOMAIN=$DOMAIN
SUPABASE_URL=$SUPABASE_URL
SUPABASE_KEY=$SUPABASE_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
AUDIO_LINK_SECRET=$(openssl rand -hex 32)
OWNER_EMAILS=${OWNER_EMAILS:-atharvakanawade@gmail.com}
EOF
else
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" "$KIT/.env"
  echo "Keeping existing settings."
fi
[ -f "$KIT/cookies.txt" ] || { touch "$KIT/cookies.txt"; chmod 600 "$KIT/cookies.txt"; }

say "6/6 Build and start (first build takes ~5 minutes)"
cd "$KIT"
sudo docker compose up -d --build

echo
echo "Waiting for https://$DOMAIN/health ..."
for _ in $(seq 1 40); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then
    curl -fsS "https://$DOMAIN/health"; echo
    say "Live at https://$DOMAIN"
    echo "Next: add  https://$DOMAIN/auth/return**  to Supabase Redirect URLs,"
    echo "      upload cookies.txt (docs/DEPLOY.md), then rebuild the APK with this address."
    exit 0
  fi
  sleep 6
done
echo "Not answering yet. Check:  cd $KIT && sudo docker compose logs --tail 50"
echo "If HTTPS fails, make sure ports 80 and 443 are open in the VCN security list (docs/DEPLOY.md)."
exit 1
