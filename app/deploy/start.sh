#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/luzhniki-pass-check/app"
cd -- "${APP_DIR}"
# Не вызываем pnpm: системный 9 пишет в недоступный HOME и ломает старт.
# sites-env.sh направляет HOME/кэш в writable .sites-runtime.
exec bash "${APP_DIR}/scripts/sites-env.sh" -- node "${APP_DIR}/scripts/start-server.mjs"
