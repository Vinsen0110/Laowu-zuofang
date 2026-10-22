#!/usr/bin/env bash
# Pull the latest code and restart: sudo bash /srv/laowu/app/deploy/update.sh
set -euo pipefail
BRANCH="${LAOWU_BRANCH:-main}"
cd /srv/laowu/app
sudo -u laowu git fetch -q origin
sudo -u laowu git reset -q --hard "origin/$BRANCH"
sudo -u laowu npm ci --omit=dev --no-audit --no-fund
systemctl restart laowu
sleep 2
systemctl --no-pager --lines=5 status laowu | head -12
