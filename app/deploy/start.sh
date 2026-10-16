#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/luzhniki-pass-check/app
exec pnpm run start

