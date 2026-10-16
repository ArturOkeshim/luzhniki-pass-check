#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/etc/luzhniki-pass-check.env"
ACCOUNTS_FILE="/root/luzhniki-pass-check-accounts.txt"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ОШИБКА: запустите скрипт от root." >&2
  exit 1
fi

for command_name in openssl install; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ОШИБКА: не найдена команда ${command_name}." >&2
    exit 1
  fi
done

if [[ -e "${CONFIG_FILE}" && "${1:-}" != "--force" ]]; then
  echo "ОШИБКА: ${CONFIG_FILE} уже существует." >&2
  echo "Для полной замены конфигурации и паролей запустите: $0 --force" >&2
  exit 1
fi

echo "Введите URL входящего вебхука Bitrix. Ввод не будет скрыт."
read -r -p "B24_WEBHOOK_URL: " B24_WEBHOOK_URL
if [[ ! "${B24_WEBHOOK_URL}" =~ ^https://crm\.luzhniki\.ru/rest/[0-9]+/[A-Za-z0-9._-]+/?$ ]]; then
  echo "ОШИБКА: ожидается https://crm.luzhniki.ru/rest/ID/TOKEN/" >&2
  exit 1
fi
[[ "${B24_WEBHOOK_URL}" == */ ]] || B24_WEBHOOK_URL="${B24_WEBHOOK_URL}/"

echo "Введите токен уже установленного шлюза приёмника. Ввод скрыт."
read -r -s -p "RECEIVER_GATEWAY_TOKEN: " RECEIVER_GATEWAY_TOKEN
echo
if [[ ! "${RECEIVER_GATEWAY_TOKEN}" =~ ^[A-Za-z0-9._-]{32,256}$ ]]; then
  echo "ОШИБКА: токен должен содержать 32–256 безопасных символов." >&2
  exit 1
fi

umask 077
SERVICE_SESSION_SECRET="$(openssl rand -hex 32)"
declare -a ACCOUNT_PASSWORDS=()
for index in 1 2 3 4 5; do
  ACCOUNT_PASSWORDS+=("$(openssl rand -hex 12)")
done

if [[ -e "${CONFIG_FILE}" ]]; then
  backup="${CONFIG_FILE}.before-$(date +%Y%m%d-%H%M%S)"
  cp -a -- "${CONFIG_FILE}" "${backup}"
  chmod 0600 "${backup}"
  echo "Старая конфигурация сохранена: ${backup}"
fi

temp_config="$(mktemp /etc/luzhniki-pass-check.env.XXXXXX)"
{
  printf 'B24_WEBHOOK_URL=%s\n' "${B24_WEBHOOK_URL}"
  printf 'B24_PORTAL_HOST=crm.luzhniki.ru\n'
  printf 'B24_SUBSCRIPTION_CATEGORY_ID=40\n'
  printf 'B24_SUBSCRIPTION_PAID_STAGE_ID=C40:WON\n'
  printf 'B24_EXCLUDED_PRODUCT_IDS=4768\n'
  printf 'B24_SUBSCRIPTION_DURATION_DAYS=30\n'
  printf '\n'
  for index in 1 2 3 4 5; do
    password_index=$((index - 1))
    printf 'SERVICE_AUTH_LOGIN_%d=guard%02d\n' "${index}" "${index}"
    printf 'SERVICE_AUTH_PASSWORD_%d=%s\n' "${index}" "${ACCOUNT_PASSWORDS[${password_index}]}"
  done
  printf 'SERVICE_SESSION_SECRET=%s\n' "${SERVICE_SESSION_SECRET}"
  printf '\n'
  printf 'RECEIVER_GATEWAY_URL=https://crm.luzhniki.ru/parking-receiver-check/api.php\n'
  printf 'RECEIVER_GATEWAY_HOST=crm.luzhniki.ru\n'
  printf 'RECEIVER_GATEWAY_TOKEN=%s\n' "${RECEIVER_GATEWAY_TOKEN}"
  printf 'RECEIVER_CACHE_TTL_SECONDS=30\n'
  printf '\n'
  printf 'SERVICE_PORT=8788\n'
} >"${temp_config}"
install -o root -g root -m 0600 "${temp_config}" "${CONFIG_FILE}"
rm -f -- "${temp_config}"

temp_accounts="$(mktemp /root/luzhniki-pass-check-accounts.txt.XXXXXX)"
{
  printf 'Аккаунты сервиса проверки абонементов «Лужники»\n'
  printf 'Созданы: %s\n\n' "$(date --iso-8601=seconds)"
  for index in 1 2 3 4 5; do
    password_index=$((index - 1))
    printf 'guard%02d  %s\n' "${index}" "${ACCOUNT_PASSWORDS[${password_index}]}"
  done
  printf '\nПосле передачи паролей сотрудникам удалите этот файл безопасным способом.\n'
} >"${temp_accounts}"
install -o root -g root -m 0600 "${temp_accounts}" "${ACCOUNTS_FILE}"
rm -f -- "${temp_accounts}"

unset B24_WEBHOOK_URL RECEIVER_GATEWAY_TOKEN SERVICE_SESSION_SECRET ACCOUNT_PASSWORDS

echo "Готово: ${CONFIG_FILE}"
echo "Пять логинов и паролей сохранены только для root: ${ACCOUNTS_FILE}"
echo "Пароли на экран не выводились."

