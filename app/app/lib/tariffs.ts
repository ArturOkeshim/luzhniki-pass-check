export type TariffInfo = {
  name: string;
  accessPeriod: string;
};

const TARIFFS = {
  standard: {
    name: "Посетитель · будни и выходные",
    accessPeriod: "Любой день · 06:00–01:00 · без ограничения по времени",
  },
  clientAll: {
    name: "Резиденты — взрослые · будни и выходные",
    accessPeriod: "Любой день · 06:00–01:00 · без ограничения по времени",
  },
  clientWeekdays: {
    name: "Резиденты — взрослые · будни",
    accessPeriod: "Рабочие дни · 06:00–01:00 · до 4 часов",
  },
  parentAll: {
    name: "Резиденты — дети (до 18 лет) · будни и выходные",
    accessPeriod: "Любой день · 06:00–23:00 · до 4 часов",
  },
  parentWeekdays: {
    name: "Резиденты — дети (до 18 лет) · будни",
    accessPeriod: "Рабочие дни · 06:00–23:00 · до 4 часов",
  },
  friendshipAll: {
    name: "Резиденты — дети (до 18 лет) · Дружба · будни и выходные",
    accessPeriod: "Любой день · 06:00–23:00 · до 5 часов",
  },
  friendshipWeekdays: {
    name: "Резиденты — дети (до 18 лет) · Дружба · будни",
    accessPeriod: "Рабочие дни · 06:00–23:00 · до 5 часов",
  },
  night: {
    name: "Ночной абонемент",
    accessPeriod: "Любой день · 01:00–06:00",
  },
} satisfies Record<string, TariffInfo>;

const BITRIX_PRODUCTS: Record<string, TariffInfo> = {
  "4666": TARIFFS.clientAll,
  "4751": TARIFFS.standard,
  "4752": TARIFFS.clientAll,
  "4753": TARIFFS.parentAll,
  "4754": TARIFFS.clientWeekdays,
  "4755": TARIFFS.parentWeekdays,
  "4841": TARIFFS.friendshipAll,
  "4842": TARIFFS.friendshipWeekdays,
};

const RECEIVER_RATES: Record<number, TariffInfo> = {
  13: TARIFFS.standard,
  14: TARIFFS.clientAll,
  15: TARIFFS.clientWeekdays,
  16: TARIFFS.parentAll,
  17: TARIFFS.parentWeekdays,
  18: TARIFFS.friendshipWeekdays,
  19: TARIFFS.friendshipAll,
  20: TARIFFS.night,
};

export function tariffByBitrixProduct(
  productId: unknown,
  productName: unknown,
): TariffInfo | null {
  const known = BITRIX_PRODUCTS[String(productId ?? "")];
  if (known) return known;

  const name = String(productName ?? "").toLowerCase();
  if (!name.includes("абонемент")) return null;
  if (name.includes("дружба") && name.includes("будни") && !name.includes("выход")) {
    return TARIFFS.friendshipWeekdays;
  }
  if (name.includes("дружба")) return TARIFFS.friendshipAll;
  if (name.includes("дет") && name.includes("будни") && !name.includes("выход")) {
    return TARIFFS.parentWeekdays;
  }
  if (name.includes("дет") || name.includes("ребён") || name.includes("ребен")) {
    return TARIFFS.parentAll;
  }
  if (name.includes("взросл") && name.includes("будни") && !name.includes("выход")) {
    return TARIFFS.clientWeekdays;
  }
  if (name.includes("клиент") || name.includes("резидент")) return TARIFFS.clientAll;
  if (name.includes("посетител") || name.includes("кто угодно")) return TARIFFS.standard;
  return null;
}

export function tariffByReceiverRate(rateId: number): TariffInfo {
  return (
    RECEIVER_RATES[rateId] ?? {
      name: `Тариф ID ${rateId}`,
      accessPeriod: "Период посещения не указан",
    }
  );
}

