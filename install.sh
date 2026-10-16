#!/usr/bin/env bash
set -Eeuo pipefail

PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_APP="${PACKAGE_DIR}/app"
APP_ROOT="/opt/luzhniki-pass-check"
APP_DIR="${APP_ROOT}/app"
CONFIG_FILE="/etc/luzhniki-pass-check.env"
SERVICE_NAME="luzhniki-pass-check"
SERVICE_USER="luzhniki-pass"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE_DIR="${APP_ROOT}/app-stage-${STAMP}-$$"
BACKUP_DIR="${APP_ROOT}/app-before-${STAMP}"
FAILED_DIR="${APP_ROOT}/app-failed-${STAMP}"
SWAPPED=0
HAD_PREVIOUS=0

if [[ "${EUID}" -ne 0 ]]; then
  echo "ОШИБКА: запустите install.sh от root." >&2
  exit 1
fi

for command_name in node curl systemctl install useradd; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ОШИБКА: не найдена команда ${command_name}. См. INSTALL.md." >&2
    exit 1
  fi
done

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) process.exit(1);
' || {
  echo "ОШИБКА: требуется Node.js 22.13 или новее." >&2
  exit 1
}

LOCAL_PNPM="${PACKAGE_DIR}/.tools/bin/pnpm"
if [[ -x "${LOCAL_PNPM}" ]]; then
  PNPM="${LOCAL_PNPM}"
elif command -v pnpm >/dev/null 2>&1; then
  PNPM="$(command -v pnpm)"
else
  PNPM=""
fi
install_pnpm_hint() {
  echo "Системный pnpm не трогайте. Один раз поставьте 11 рядом с проектом:" >&2
  echo "  mkdir -p ${PACKAGE_DIR}/.tools" >&2
  echo "  npm install --prefix ${PACKAGE_DIR}/.tools -g pnpm@11.25.0" >&2
}
if [[ -z "${PNPM}" ]]; then
  echo "ОШИБКА: не найден pnpm." >&2
  install_pnpm_hint
  exit 1
fi
pnpm_major="$("${PNPM}" --version | cut -d. -f1)"
if [[ "${pnpm_major}" -lt 11 ]]; then
  echo "ОШИБКА: нужен pnpm 11, сейчас $("${PNPM}" --version) (${PNPM})." >&2
  install_pnpm_hint
  exit 1
fi
echo "pnpm $("${PNPM}" --version)  ${PNPM}"

if [[ ! -r "${CONFIG_FILE}" ]]; then
  echo "ОШИБКА: отсутствует ${CONFIG_FILE}. Сначала запустите ./configure.sh" >&2
  exit 1
fi
if [[ ! -f "${SOURCE_APP}/package.json" || ! -f "${SOURCE_APP}/pnpm-lock.yaml" ]]; then
  echo "ОШИБКА: пакет приложения неполный." >&2
  exit 1
fi

config_mode="$(stat -c '%a' "${CONFIG_FILE}")"
if [[ "${config_mode}" != "600" ]]; then
  echo "ОШИБКА: права ${CONFIG_FILE} должны быть 600, сейчас ${config_mode}." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${CONFIG_FILE}"
set +a
node "${SOURCE_APP}/deploy/preflight.mjs"

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  nologin_shell="$(command -v nologin || true)"
  [[ -n "${nologin_shell}" ]] || nologin_shell="/sbin/nologin"
  useradd --system --home-dir "${APP_ROOT}" --shell "${nologin_shell}" "${SERVICE_USER}"
fi

install -d -o root -g root -m 0755 "${APP_ROOT}"
install -d -o root -g root -m 0755 "${STAGE_DIR}"
cp -a -- "${SOURCE_APP}/." "${STAGE_DIR}/"
chmod 0755 "${STAGE_DIR}/deploy/start.sh"

echo "Устанавливаю зависимости и собираю приложение…"
(
  cd -- "${STAGE_DIR}"
  export CI=1
  export PATH="$(dirname -- "${PNPM}"):${PATH}"
  "${PNPM}" install --frozen-lockfile
  "${PNPM}" exec tsc --noEmit --incremental false
  "${PNPM}" run build
)
chown -R root:root "${STAGE_DIR}"

rollback() {
  exit_code=$?
  if [[ "${exit_code}" -ne 0 && "${SWAPPED}" -eq 1 ]]; then
    echo "Установка не завершена. Выполняю откат…" >&2
    systemctl stop "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    if [[ -d "${APP_DIR}" ]]; then
      mv -- "${APP_DIR}" "${FAILED_DIR}"
    fi
    if [[ "${HAD_PREVIOUS}" -eq 1 && -d "${BACKUP_DIR}" ]]; then
      mv -- "${BACKUP_DIR}" "${APP_DIR}"
      systemctl start "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    fi
  fi
  exit "${exit_code}"
}
trap rollback EXIT

systemctl stop "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
if [[ -e "${BACKUP_DIR}" ]]; then
  echo "ОШИБКА: каталог резервной копии уже существует: ${BACKUP_DIR}" >&2
  exit 1
fi
if [[ -d "${APP_DIR}" ]]; then
  mv -- "${APP_DIR}" "${BACKUP_DIR}"
  HAD_PREVIOUS=1
fi
mv -- "${STAGE_DIR}" "${APP_DIR}"
SWAPPED=1

install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0700 \
  "${APP_DIR}/.sites-runtime" \
  "${APP_DIR}/.sites-runtime/home" \
  "${APP_DIR}/.sites-runtime/xdg-config" \
  "${APP_DIR}/.sites-runtime/xdg-cache" \
  "${APP_DIR}/.sites-runtime/tmp"
install -o root -g root -m 0644 \
  "${APP_DIR}/deploy/luzhniki-pass-check.service" \
  "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

health_json=""
for _attempt in $(seq 1 60); do
  if health_json="$(curl --fail --silent --show-error \
    --connect-timeout 2 --max-time 5 \
    http://127.0.0.1:8788/api/auth/status 2>/dev/null)"; then
    break
  fi
  sleep 1
done

if [[ -z "${health_json}" ]]; then
  systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
  journalctl -u "${SERVICE_NAME}.service" -n 80 --no-pager || true
  echo "ОШИБКА: сервис не ответил на http://127.0.0.1:8788/api/auth/status" >&2
  exit 1
fi

printf '%s' "${health_json}" | node -e '
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => {
    const value = JSON.parse(body);
    if (value.configured !== true || value.authenticated !== false) process.exit(1);
  });
' || {
  systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
  echo "ОШИБКА: сервис ответил, но проверка /api/auth/status не прошла: ${health_json}" >&2
  exit 1
}

trap - EXIT
echo "Готово: ${SERVICE_NAME}.service запущен на 127.0.0.1:8788."
if [[ "${HAD_PREVIOUS}" -eq 1 ]]; then
  echo "Предыдущая версия сохранена: ${BACKUP_DIR}"
fi
echo "Теперь настройте nginx и HTTPS по инструкции INSTALL.md."

