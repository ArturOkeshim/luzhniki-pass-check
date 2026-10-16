import {
  findOutstandingFinePlates,
  findSubscriptions as findBitrixSubscriptions,
} from "./bitrix";
import { plateKey } from "./plate";
import { findReceiverSubscriptions } from "./receiver";
import type { PlateCheck, Subscription } from "./subscription-types";

export class IncompleteSubscriptionCheckError extends Error {}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "unknown error";
}

export async function findPlateChecks(
  fragment: string,
): Promise<PlateCheck[]> {
  const [bitrix, fines] = await Promise.allSettled([
    findBitrixSubscriptions(fragment),
    findOutstandingFinePlates(fragment),
  ]);
  if (bitrix.status === "rejected" || fines.status === "rejected") {
    throw new IncompleteSubscriptionCheckError(
      `Bitrix unavailable: subscriptions ${bitrix.status === "rejected" ? errorMessage(bitrix.reason) : "ok"}; fines ${fines.status === "rejected" ? errorMessage(fines.reason) : "ok"}`,
    );
  }

  const bitrixItems = bitrix.value;
  const finePlates = fines.value;
  let subscriptions: Subscription[] = bitrixItems;

  // Bitrix is the primary source. The receiver is queried only when Bitrix has
  // no matching subscription. A receiver failure must never become a false
  // "not found" result.
  if (subscriptions.length === 0) {
    try {
      subscriptions = await findReceiverSubscriptions(fragment);
    } catch (error) {
      throw new IncompleteSubscriptionCheckError(
        `Receiver unavailable: ${errorMessage(error)}`,
      );
    }
  }

  const fineKeys = new Set(finePlates.map((plate) => plateKey(plate)));
  const checks = new Map<string, PlateCheck>();

  for (const item of subscriptions) {
    const key = plateKey(item.plate);
    checks.set(key, {
      ...item,
      hasFine: fineKeys.has(key),
    });
  }

  for (const plate of finePlates) {
    const key = plateKey(plate);
    if (!checks.has(key)) {
      checks.set(key, {
        plate,
        status: "none",
        dateFrom: null,
        dateTo: null,
        tariffName: null,
        accessPeriod: null,
        hasFine: true,
      });
    }
  }

  return [...checks.values()].sort((left, right) =>
    left.plate.localeCompare(right.plate, "ru"),
  );
}

