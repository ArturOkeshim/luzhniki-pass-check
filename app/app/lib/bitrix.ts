import { requiredRuntimeValue, runtimeValue } from "./runtime-config";
import {
  displayPlate,
  inclusiveEndDate,
  isoDate,
  latinPlateVariant,
  plateKey,
} from "./plate";
import { moscowDate, periodStatus } from "./moscow-time";
import type { Subscription } from "./subscription-types";
import { tariffByBitrixProduct } from "./tariffs";

type BitrixEnvelope<T> = {
  result?: T;
  error?: unknown;
  next?: unknown;
};

type Deal = Record<string, unknown> & {
  ID?: string | number;
};

type ProductRow = Record<string, unknown> & {
  PRODUCT_ID?: string | number;
  PRODUCT_NAME?: string;
};

type BatchResult = {
  result?: Record<string, ProductRow[]>;
};

const PLATE_FIELD = "UF_CRM_6A427BE0EA767";
const START_FIELD = "UF_CRM_DEAL_1782746372939";
const FINE_ENTITY_TYPE_ID = 1112;
const FINE_CATEGORY_ID = 71;
const FINE_PLATE_FIELD = "ufCrm_6A428CDD7BD93";
const PAID_FINE_STAGE_ID = "DT1112_71:SUCCESS";

function methodUrl(method: string): URL {
  const raw = requiredRuntimeValue("B24_WEBHOOK_URL");
  const base = new URL(raw.endsWith("/") ? raw : `${raw}/`);
  const expectedHost = runtimeValue("B24_PORTAL_HOST", "crm.luzhniki.ru");
  if (
    base.protocol !== "https:" ||
    base.hostname.toLowerCase() !== expectedHost.toLowerCase() ||
    !/^\/rest\/\d+\/[^/]+\/$/u.test(base.pathname)
  ) {
    throw new Error("Invalid Bitrix webhook configuration");
  }
  return new URL(`${method}.json`, base);
}

async function bitrixRequestEnvelope<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<BitrixEnvelope<T>> {
  const response = await fetch(methodUrl(method), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json;charset=UTF-8",
    },
    body: JSON.stringify(params),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | BitrixEnvelope<T>
    | null;
  if (!response.ok || !payload || payload.error || payload.result === undefined) {
    throw new Error(`Bitrix request failed: ${method}`);
  }
  return payload;
}

async function bitrixRequest<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  return (await bitrixRequestEnvelope<T>(method, params)).result as T;
}

function dealId(deal: Deal): string {
  return String(deal.ID ?? deal.id ?? "").trim();
}

function value(deal: Deal, field: string): unknown {
  return deal[field] ?? deal[field.toLowerCase()];
}

async function searchDeals(fragment: string): Promise<Deal[]> {
  const categoryId = runtimeValue("B24_SUBSCRIPTION_CATEGORY_ID", "40");
  const paidStageId = runtimeValue("B24_SUBSCRIPTION_PAID_STAGE_ID", "C40:WON");
  const variants = [...new Set([fragment, latinPlateVariant(fragment)])];

  const responses = await Promise.all(
    variants.map(async (variant) => {
      const deals: Deal[] = [];
      let start = 0;
      const usedStarts = new Set<number>();

      for (let page = 0; page < 100; page += 1) {
        if (usedStarts.has(start)) throw new Error("Bitrix repeated a page cursor");
        usedStarts.add(start);
        const response = await bitrixRequestEnvelope<Deal[]>("crm.deal.list", {
          order: { ID: "DESC" },
          filter: {
            CATEGORY_ID: categoryId,
            STAGE_ID: paidStageId,
            [`%${PLATE_FIELD}`]: variant,
          },
          select: ["ID", PLATE_FIELD, START_FIELD],
          start,
        });
        deals.push(...(response.result ?? []));
        if (response.next === undefined || response.next === null) return deals;
        if (!Number.isSafeInteger(response.next) || (response.next as number) < 0) {
          throw new Error("Bitrix returned an invalid page cursor");
        }
        start = response.next as number;
      }
      throw new Error("Bitrix page limit exceeded");
    }),
  );

  const unique = new Map<string, Deal>();
  for (const deal of responses.flat()) {
    const id = dealId(deal);
    if (id) unique.set(id, deal);
  }
  return [...unique.values()];
}

async function productRowsByDeal(
  deals: Deal[],
): Promise<Record<string, ProductRow[]>> {
  const rows: Record<string, ProductRow[]> = {};

  for (let offset = 0; offset < deals.length; offset += 50) {
    const chunk = deals.slice(offset, offset + 50);
    const commands = Object.fromEntries(
      chunk.map((deal, index) => [
        `deal_${index}`,
        `crm.deal.productrows.get?id=${encodeURIComponent(dealId(deal))}`,
      ]),
    );
    const batch = await bitrixRequest<BatchResult>("batch", {
      halt: 0,
      cmd: commands,
    });
    chunk.forEach((deal, index) => {
      rows[dealId(deal)] = batch.result?.[`deal_${index}`] ?? [];
    });
  }
  return rows;
}

function isTestProduct(row: ProductRow): boolean {
  const excludedIds = new Set(
    runtimeValue("B24_EXCLUDED_PRODUCT_IDS", "4768")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const id = String(row.PRODUCT_ID ?? row.productId ?? "");
  const name = String(row.PRODUCT_NAME ?? row.productName ?? "");
  return excludedIds.has(id) || /тест|провер(ка|ки)/iu.test(name);
}

export async function findSubscriptions(fragment: string): Promise<Subscription[]> {
  const duration = Math.max(
    1,
    Number(runtimeValue("B24_SUBSCRIPTION_DURATION_DAYS", "30")) || 30,
  );
  const today = moscowDate();
  const deals = await searchDeals(fragment);
  if (!deals.length) return [];

  const products = await productRowsByDeal(deals);

  const result: Subscription[] = [];
  for (const deal of deals) {
    const rows = products[dealId(deal)] ?? [];
    const tariffRow = rows.find(
      (row) => !isTestProduct(row) && tariffByBitrixProduct(
        row.PRODUCT_ID ?? row.productId,
        row.PRODUCT_NAME ?? row.productName,
      ),
    );
    if (!tariffRow) continue;

    const plate = displayPlate(value(deal, PLATE_FIELD));
    const dateFrom = isoDate(value(deal, START_FIELD));
    const dateTo = inclusiveEndDate(dateFrom, duration);
    if (!plate || !dateFrom || !dateTo) {
      continue;
    }
    const tariff = tariffByBitrixProduct(
      tariffRow.PRODUCT_ID ?? tariffRow.productId,
      tariffRow.PRODUCT_NAME ?? tariffRow.productName,
    );
    if (!tariff) continue;
    result.push({
      plate,
      dateFrom,
      dateTo,
      tariffName: tariff.name,
      accessPeriod: tariff.accessPeriod,
      status: periodStatus(dateFrom, dateTo, today),
    });
  }

  const deduplicated = new Map<string, Subscription>();
  for (const item of result) {
    const key = plateKey(item.plate);
    const current = deduplicated.get(key);
    if (!current || isPreferredSubscription(item, current)) {
      deduplicated.set(key, item);
    }
  }
  return [...deduplicated.values()].sort(
    (left, right) =>
      right.dateFrom.localeCompare(left.dateFrom) ||
      left.plate.localeCompare(right.plate, "ru"),
  );
}

function isPreferredSubscription(
  candidate: Subscription,
  current: Subscription,
): boolean {
  const priority = { active: 3, future: 2, expired: 1 } as const;
  if (priority[candidate.status] !== priority[current.status]) {
    return priority[candidate.status] > priority[current.status];
  }
  if (candidate.status === "future") {
    return candidate.dateFrom < current.dateFrom;
  }
  return candidate.dateTo > current.dateTo;
}

type FineItem = Record<string, unknown> & {
  id?: string | number;
  stageId?: string;
};

type FineList = {
  items?: FineItem[];
};

function finePlate(item: FineItem): string {
  const upper = FINE_PLATE_FIELD.replace(/^ufCrm_?/u, "UF_CRM_").toUpperCase();
  return displayPlate(item[FINE_PLATE_FIELD] ?? item[upper]);
}

async function searchFineItems(fragment: string): Promise<FineItem[]> {
  const isFullPlate = /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/u.test(
    fragment,
  );
  // Smart-process fields do not support Bitrix's "%field" substring
  // operator. Full plates are filtered server-side; partial searches load the
  // fine category and are narrowed locally.
  const variants: Array<string | null> = isFullPlate
    ? [...new Set([fragment, latinPlateVariant(fragment)])]
    : [null];
  const responses = await Promise.all(
    variants.map(async (variant) => {
      const items: FineItem[] = [];
      let start = 0;
      const usedStarts = new Set<number>();

      for (let page = 0; page < 100; page += 1) {
        if (usedStarts.has(start)) throw new Error("Bitrix repeated a fine cursor");
        usedStarts.add(start);
        const response = await bitrixRequestEnvelope<FineList>("crm.item.list", {
          entityTypeId: FINE_ENTITY_TYPE_ID,
          order: { id: "DESC" },
          filter: {
            categoryId: FINE_CATEGORY_ID,
            ...(variant ? { [FINE_PLATE_FIELD]: variant } : {}),
          },
          select: ["id", "stageId", FINE_PLATE_FIELD],
          start,
        });
        items.push(...(response.result?.items ?? []));
        if (response.next === undefined || response.next === null) return items;
        if (!Number.isSafeInteger(response.next) || (response.next as number) < 0) {
          throw new Error("Bitrix returned an invalid fine cursor");
        }
        start = response.next as number;
      }
      throw new Error("Bitrix fine page limit exceeded");
    }),
  );

  const unique = new Map<string, FineItem>();
  for (const item of responses.flat()) {
    const id = String(item.id ?? item.ID ?? "").trim();
    if (id) unique.set(id, item);
  }
  return [...unique.values()];
}

export async function findOutstandingFinePlates(
  fragment: string,
): Promise<string[]> {
  const query = plateKey(fragment);
  const plates = new Map<string, string>();
  for (const item of await searchFineItems(fragment)) {
    if (item.stageId === PAID_FINE_STAGE_ID) continue;
    const plate = finePlate(item);
    const key = plateKey(plate);
    if (plate && key.includes(query)) plates.set(key, plate);
  }
  return [...plates.values()].sort((left, right) =>
    left.localeCompare(right, "ru"),
  );
}
