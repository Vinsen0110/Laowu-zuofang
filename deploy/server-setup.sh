#!/usr/bin/env bash
# One-time setup of the Hong Kong server (Ubuntu 24.04). Run as root:
#   sudo bash deploy/server-setup.sh test.vinsen.top
# Installs Node 22, PostgreSQL, Caddy (HTTPS + compression), the app as a
# systemd service, daily database backups and the daily balance check.
set -euo pipefail

DOMAINS="${*:-test.vinsen.top}"
APP_USER=laowu
APP_DIR=/srv/laowu/app
ENV_FILE=/etc/laowu/laowu.env
REPO=https://github.com/Vinsen0110/Laowu-zuofang.git
BRANCH="${LAOWU_BRANCH:-main}"

export DEBIAN_FRONTEND=noninteractive

# 2 GB swap so builds and Postgres fit comfortably in 2 GB of RAM.
if ! swapon --show | grep -q /swapfile; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -y
apt-get install -y ca-certificates curl gnupg git postgresql postgresql-contrib debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

# Node.js 22
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

# Caddy
if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
fi

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/laowu --shell /usr/sbin/nologin "$APP_USER"
mkdir -p /srv/laowu/backups /etc/laowu
chown -R "$APP_USER:$APP_USER" /srv/laowu

# Database and secrets (generated once, kept on re-runs).
if [ ! -f "$ENV_FILE" ]; then
    DB_PASS=$(openssl rand -hex 24)
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE laowu LOGIN PASSWORD '$DB_PASS';" || true
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE laowu OWNER laowu;" || true
    cat > "$ENV_FILE" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=4173
TRUST_PROXY=1
DATABASE_URL=postgres://laowu:$DB_PASS@127.0.0.1:5432/laowu
LW_DB_DRIVER=pg
LW_ADMIN_EMAILS=1649341617@qq.com
LW_MAIL_FROM="老屋作坊 <no-reply@send.vinsen.top>"
LW_IMG_SECRET=$(openssl rand -hex 32)
ENV
    chmod 640 "$ENV_FILE" && chown root:"$APP_USER" "$ENV_FILE"
fi

# Code
if [ ! -d "$APP_DIR/.git" ]; then
    sudo -u "$APP_USER" git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR" && sudo -u "$APP_USER" git fetch -q origin && sudo -u "$APP_USER" git checkout -q "$BRANCH" && sudo -u "$APP_USER" git reset -q --hard "origin/$BRANCH"
sudo -u "$APP_USER" npm ci --omit=dev --no-audit --no-fund

install -m 644 "$APP_DIR/deploy/laowu.service" /etc/systemd/system/laowu.service
systemctl daemon-reload
systemctl enable --now laowu
systemctl restart laowu

# Caddy site for every domain given (HTTPS certificates are automatic).
{
    for d in $DOMAINS; do
        cat <<SITE
$d {
	encode zstd gzip
	reverse_proxy 127.0.0.1:4173 {
		flush_interval -1
	}
}
SITE
    done
} > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# Daily: Postgres backup (kept 14 days) and the supplier balance check.
cat > /etc/cron.d/laowu <<'CRON'
SHELL=/bin/bash
15 3 * * * postgres pg_dump -Fc laowu > /srv/laowu/backups/laowu-$(date +\%F).dump && find /srv/laowu/backups -name 'laowu-*.dump' -mtime +14 -delete
0 9 * * * laowu curl -fsS http://127.0.0.1:4173/api/account/cron/balances >/dev/null
CRON
chown postgres:postgres /srv/laowu/backups
timedatectl set-timezone Asia/Shanghai || true

echo "Done. Sites: $DOMAINS"
