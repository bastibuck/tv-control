#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Updating tv-control in ${repo_root}"

git -C "${repo_root}" pull --ff-only
pnpm --dir "${repo_root}" install --frozen-lockfile
pnpm --dir "${repo_root}" build
sudo cp "${repo_root}/deploy/tv-control.service" /etc/systemd/system/tv-control.service
sudo systemctl daemon-reload
sudo systemctl restart tv-control
sudo systemctl status --no-pager tv-control
