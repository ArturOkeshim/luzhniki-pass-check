const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Не задан ${name}`);
  return value;
};

const bitrixUrl = new URL(required("B24_WEBHOOK_URL"));
if (
  bitrixUrl.protocol !== "https:" ||
  bitrixUrl.hostname !== "crm.luzhniki.ru" ||
  !/^\/rest\/\d+\/[A-Za-z0-9._-]+\/$/u.test(bitrixUrl.pathname)
) {
  throw new Error("Некорректный B24_WEBHOOK_URL");
}
if (required("B24_PORTAL_HOST") !== "crm.luzhniki.ru") {
  throw new Error("Некорректный B24_PORTAL_HOST");
}
if (required("B24_SUBSCRIPTION_CATEGORY_ID") !== "40") {
  throw new Error("Ожидается воронка абонементов 40");
}
if (required("B24_SUBSCRIPTION_PAID_STAGE_ID") !== "C40:WON") {
  throw new Error("Некорректная оплаченная стадия Bitrix");
}
if (!required("B24_EXCLUDED_PRODUCT_IDS").split(",").map((item) => item.trim()).includes("4768")) {
  throw new Error("Тестовый товар 4768 должен быть исключён");
}

const sessionSecret = required("SERVICE_SESSION_SECRET");
if (sessionSecret.length < 32) throw new Error("SERVICE_SESSION_SECRET слишком короткий");

const logins = new Set();
for (let index = 1; index <= 5; index += 1) {
  const login = required(`SERVICE_AUTH_LOGIN_${index}`);
  const password = required(`SERVICE_AUTH_PASSWORD_${index}`);
  if (login !== `guard${String(index).padStart(2, "0")}`) {
    throw new Error(`Некорректный логин аккаунта ${index}`);
  }
  if (password.length < 12) throw new Error(`Пароль аккаунта ${index} слишком короткий`);
  if (logins.has(login)) throw new Error("Логины аккаунтов должны быть уникальными");
  logins.add(login);
}

const gatewayUrl = new URL(required("RECEIVER_GATEWAY_URL"));
if (
  gatewayUrl.protocol !== "https:" ||
  gatewayUrl.hostname !== "crm.luzhniki.ru" ||
  gatewayUrl.pathname !== "/parking-receiver-check/api.php" ||
  gatewayUrl.search ||
  gatewayUrl.hash
) {
  throw new Error("Некорректный RECEIVER_GATEWAY_URL");
}
if (required("RECEIVER_GATEWAY_HOST") !== "crm.luzhniki.ru") {
  throw new Error("Некорректный RECEIVER_GATEWAY_HOST");
}
if (required("RECEIVER_GATEWAY_TOKEN").length < 32) {
  throw new Error("RECEIVER_GATEWAY_TOKEN слишком короткий");
}
if (required("SERVICE_PORT") !== "8788") {
  throw new Error("SERVICE_PORT должен быть равен 8788");
}

console.log("Конфигурация корректна: Bitrix, шлюз приёмника и 5 аккаунтов заданы.");

