# Установка на сервер

Инструкция рассчитана на Linux с systemd и nginx. Приложение устанавливается в `/opt/luzhniki-pass-check`, конфигурация — в `/etc/luzhniki-pass-check.env`.

## 1. Требования

Нужны:

- Node.js 22.13 или новее, установленный системно;
- pnpm 11;
- `curl`, `openssl`, `tar`, `systemd`;
- nginx и домен, направленный на сервер;
- действующий HTTPS-сертификат или возможность выпустить его через Certbot;
- URL входящего вебхука Bitrix;
- токен уже установленного шлюза приёмника.

Проверка:

```bash
node --version
pnpm --version
nginx -v
systemctl --version | head -n 1
```

Если Node.js уже установлен, но pnpm отсутствует:

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm --version
```

## 2. Загрузка и проверка архива

Скопируйте на сервер два файла:

- `LUZHNIKI-PASS-CHECK-SERVER-V1.tar.gz`;
- `LUZHNIKI-PASS-CHECK-SERVER-V1.tar.gz.sha256`.

Затем выполните:

```bash
cd /root
sha256sum -c LUZHNIKI-PASS-CHECK-SERVER-V1.tar.gz.sha256
tar -xzf LUZHNIKI-PASS-CHECK-SERVER-V1.tar.gz
cd LUZHNIKI-PASS-CHECK-SERVER-V1
chmod 700 configure.sh install.sh
```

Команда `sha256sum` должна вывести `OK`.

## 3. Создание закрытой конфигурации и пяти аккаунтов

Получить токен шлюза на сервере Bitrix можно так:

```bash
cat /home/bitrix/.parking-receiver-check/token
```

На сервере приложения запустите:

```bash
cd /root/LUZHNIKI-PASS-CHECK-SERVER-V1
./configure.sh
```

Скрипт запросит URL вебхука Bitrix и токен шлюза. Он автоматически создаст:

- `/etc/luzhniki-pass-check.env` — закрытую конфигурацию с правами `0600`;
- `/root/luzhniki-pass-check-accounts.txt` — логины `guard01`…`guard05` и пять случайных паролей, также `0600`.

Посмотреть выданные аккаунты:

```bash
cat /root/luzhniki-pass-check-accounts.txt
```

Не отправляйте этот файл в общий чат и не кладите его в каталог сайта. После безопасной передачи учётных данных сотрудникам удалите файл.

Повторный запуск без аргументов не перезаписывает действующие секреты. Для осознанной полной замены конфигурации и всех паролей используется `./configure.sh --force`; старая конфигурация при этом сохраняется в `/etc` с временной меткой.

## 4. Установка приложения

```bash
cd /root/LUZHNIKI-PASS-CHECK-SERVER-V1
./install.sh
```

Скрипт:

1. проверит версии и конфигурацию;
2. установит зависимости с зафиксированным lock-файлом;
3. выполнит TypeScript-проверку и production-сборку;
4. создаст отдельного системного пользователя `luzhniki-pass`;
5. установит и запустит `luzhniki-pass-check.service`;
6. проверит локальный ответ сервиса.

Проверка после установки:

```bash
systemctl --no-pager --full status luzhniki-pass-check.service
curl --fail --silent http://127.0.0.1:8788/api/auth/status
```

Ожидаемый JSON:

```json
{"configured":true,"authenticated":false}
```

Приложение слушает только loopback-интерфейс и напрямую из сети недоступно.

## 5. nginx и HTTPS

Замените `pass.example.ru` на реальный домен:

```bash
cd /root/LUZHNIKI-PASS-CHECK-SERVER-V1
cp nginx-luzhniki-pass-check.conf.example /etc/nginx/conf.d/luzhniki-pass-check.conf
sed -i 's/pass\.example\.ru/ВАШ.ДОМЕН/g' /etc/nginx/conf.d/luzhniki-pass-check.conf
nginx -t
systemctl reload nginx
```

Затем выпустите или подключите HTTPS-сертификат. При установленном Certbot с модулем nginx:

```bash
certbot --nginx -d ВАШ.ДОМЕН --redirect
nginx -t
systemctl reload nginx
```

Не передавайте логины и пароли по обычному HTTP. В рабочую эксплуатацию сервис вводится только после включения HTTPS.

## 6. Функциональная проверка

1. Откройте `https://ВАШ.ДОМЕН/` на телефоне.
2. Войдите под одним из аккаунтов из `/root/luzhniki-pass-check-accounts.txt`.
3. Проверьте заведомо отсутствующий ГРН — должен появиться результат «ГРН не найден», а не техническая ошибка.
4. Проверьте действующий ГРН, который есть только в приёмнике. Должны отображаться тариф и период доступа.
5. Проверьте ГРН со штрафом — предупреждение должно быть заметно в карточке результата.

## 7. Диагностика

```bash
journalctl -u luzhniki-pass-check.service -n 100 --no-pager
systemctl restart luzhniki-pass-check.service
curl --fail --silent http://127.0.0.1:8788/api/auth/status
```

В журнале не должны печататься значения вебхука, паролей или токена шлюза.

## 8. Повторное обновление

Распакуйте новый пакет в отдельный каталог и снова выполните `./install.sh`. Предыдущая версия приложения будет сохранена в `/opt/luzhniki-pass-check/app-before-ДАТА-ВРЕМЯ`. Файл `/etc/luzhniki-pass-check.env` и пароли при обновлении не меняются.

