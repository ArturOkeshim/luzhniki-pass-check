import { runtimeValue } from "./runtime-config";
import { moscowDate, periodStatus } from "./moscow-time";
import {
  displayPlate,
  latinPlateVariant,
  plateKey,
  receiverDate,
} from "./plate";
import type { Subscription } from "./subscription-types";
import { tariffByReceiverRate } from "./tariffs";

type ReceiverRecord = {
  lpn: string;
  rateId: number;
  dateFrom: string;
  dateTo: string;
};

type ReceiverPage = {
  cursor?: unknown;
  items?: unknown;
  rate_limit?: { retry_after?: unknown };
  error?: unknown;
};

type ReceiverCache = {
  expiresAt: number;
  records: ReceiverRecord[];
};

type ReceiverSidecarState = {
  mode?: unknown;
  records?: unknown;
};

type ReceiverGatewayResponse = {
  mode?: unknown;
  records?: unknown;
};

let cache: ReceiverCache | null = null;
const gatewayCache = new Map<string, ReceiverCache>();

export class ReceiverUnavailableError extends Error {}

function receiverUrl(): URL {
  const raw = runtimeValue("RECEIVER_API_URL");
  if (!raw) throw new ReceiverUnavailableError("Receiver is not configured");
  let url: URL;
  try {
    url = new URL(raw.endsWith("/") ? raw : `${raw}/`);
  } catch {
    throw new ReceiverUnavailableError("Invalid receiver URL");
  }
  const allowedHosts = new Set(
    runtimeValue(
      "RECEIVER_API_HOSTS",
      "10.182.65.12,127.0.0.1,localhost",
    )
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !allowedHosts.has(url.hostname.toLowerCase())
  ) {
    throw new ReceiverUnavailableError("Invalid receiver URL");
  }
  return url;
}

function receiverAuthorization(): string {
  const user = runtimeValue("RECEIVER_API_USER");
  const password = runtimeValue("RECEIVER_API_PASSWORD");
  if (!user || !password || user.includes(":")) {
    throw new ReceiverUnavailableError("Receiver credentials are not configured");
  }
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number(runtimeValue(name, String(fallback)));
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sidecarUrl(): URL | null {
  const raw = runtimeValue("RECEIVER_SIDECAR_URL");
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ReceiverUnavailableError("Invalid receiver sidecar URL");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/state"
  ) {
    throw new ReceiverUnavailableError("Invalid receiver sidecar URL");
  }
  return url;
}

function gatewayUrl(): URL | null {
  const raw = runtimeValue("RECEIVER_GATEWAY_URL");
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ReceiverUnavailableError("Invalid receiver gateway URL");
  }
  const expectedHost = runtimeValue("RECEIVER_GATEWAY_HOST", "crm.luzhniki.ru");
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== expectedHost.toLowerCase() ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/parking-receiver-check/api.php"
  ) {
    throw new ReceiverUnavailableError("Invalid receiver gateway URL");
  }
  return url;
}

async function loadGatewayRecords(
  url: URL,
  fragment: string,
): Promise<ReceiverRecord[]> {
  const key = plateKey(fragment);
  const now = Date.now();
  const cached = gatewayCache.get(key);
  if (cached && cached.expiresAt > now) return cached.records;

  const token = runtimeValue("RECEIVER_GATEWAY_TOKEN");
  if (!token || token.length < 32) {
    throw new ReceiverUnavailableError("Receiver gateway token is not configured");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Receiver-Gateway-Token": token,
        "Content-Type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({ query: fragment }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(65_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new ReceiverUnavailableError(`Receiver gateway did not respond: ${detail}`);
  }
  const text = await response.text().catch(() => "");
  if (!response.ok || text.length > 8 * 1024 * 1024) {
    throw new ReceiverUnavailableError(`Receiver gateway request failed: ${response.status}`);
  }
  let payload: ReceiverGatewayResponse;
  try {
    payload = JSON.parse(text) as ReceiverGatewayResponse;
  } catch {
    throw new ReceiverUnavailableError("Receiver gateway returned invalid JSON");
  }
  if (payload.mode !== "live" || !Array.isArray(payload.records)) {
    throw new ReceiverUnavailableError("Receiver gateway is not connected");
  }
  const records = payload.records.map(parseRecord);
  const plates = new Set<string>();
  for (const record of records) {
    const plate = plateKey(record.lpn);
    if (!plate.includes(key)) {
      throw new ReceiverUnavailableError("Receiver gateway returned an unrelated plate");
    }
    if (plates.has(plate)) {
      throw new ReceiverUnavailableError("Receiver gateway returned a duplicate plate");
    }
    plates.add(plate);
  }
  gatewayCache.set(key, {
    records,
    expiresAt:
      Date.now() + positiveInteger("RECEIVER_CACHE_TTL_SECONDS", 30, 300) * 1000,
  });
  return records;
}

async function loadSidecarRecords(url: URL): Promise<ReceiverRecord[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new ReceiverUnavailableError(`Receiver sidecar did not respond: ${detail}`);
  }
  const text = await response.text().catch(() => "");
  if (!response.ok || text.length > 16 * 1024 * 1024) {
    throw new ReceiverUnavailableError(`Receiver sidecar request failed: ${response.status}`);
  }
  let state: ReceiverSidecarState;
  try {
    state = JSON.parse(text) as ReceiverSidecarState;
  } catch {
    throw new ReceiverUnavailableError("Receiver sidecar returned invalid JSON");
  }
  if (state.mode !== "live" || !Array.isArray(state.records)) {
    throw new ReceiverUnavailableError("Receiver sidecar is not connected");
  }
  const records = state.records.map(parseRecord);
  const plates = new Set<string>();
  for (const record of records) {
    const key = plateKey(record.lpn);
    if (plates.has(key)) {
      throw new ReceiverUnavailableError("Receiver sidecar returned a duplicate plate");
    }
    plates.add(key);
  }
  return records;
}

async function receiverPage(
  base: URL,
  authorization: string,
  cursor: number,
): Promise<ReceiverPage> {
  const pause = positiveInteger("RECEIVER_API_PAUSE_MS", 3000, 60_000);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(new URL("list/lpn", base), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify({ cursor }),
        cache: "no-store",
        // Cloudflare Workers supports manual redirects; any 3xx is rejected
        // below so credentials are never forwarded to another host.
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      throw new ReceiverUnavailableError(`Receiver did not respond: ${detail}`);
    }
    if (response.status === 429 && attempt < 5) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 60) * 1000
          : pause,
      );
      continue;
    }
    const text = await response.text().catch(() => "");
    if (!response.ok || text.length > 8 * 1024 * 1024) {
      throw new ReceiverUnavailableError(`Receiver request failed: ${response.status}`);
    }
    let payload: ReceiverPage;
    try {
      payload = JSON.parse(text) as ReceiverPage;
    } catch {
      throw new ReceiverUnavailableError("Receiver returned invalid JSON");
    }
    if (!payload || typeof payload !== "object" || payload.error) {
      throw new ReceiverUnavailableError("Receiver returned an error");
    }
    return payload;
  }
  throw new ReceiverUnavailableError("Receiver rate limit exceeded");
}

function parseRecord(value: unknown): ReceiverRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReceiverUnavailableError("Receiver returned an invalid record");
  }
  const row = value as Record<string, unknown>;
  const lpn = displayPlate(row.lpn);
  const rateId = row.rate_id;
  const dateFrom = receiverDate(row.date_from);
  const dateTo = receiverDate(row.date_to);
  if (
    !/^[A-Z0-9]{3,16}$/u.test(lpn) ||
    !Number.isSafeInteger(rateId) ||
    (rateId as number) < 0 ||
    !dateFrom ||
    !dateTo ||
    dateTo < dateFrom
  ) {
    throw new ReceiverUnavailableError("Receiver returned an invalid record");
  }
  return { lpn, rateId: rateId as number, dateFrom, dateTo };
}

async function loadReceiverRecords(fragment: string): Promise<ReceiverRecord[]> {
  const remoteGateway = gatewayUrl();
  if (remoteGateway) return loadGatewayRecords(remoteGateway, fragment);

  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.records;

  const localSidecar = sidecarUrl();
  if (localSidecar) {
    const records = await loadSidecarRecords(localSidecar);
    cache = {
      records,
      expiresAt:
        Date.now() +
        positiveInteger("RECEIVER_CACHE_TTL_SECONDS", 30, 300) * 1000,
    };
    return records;
  }

  const base = receiverUrl();
  const authorization = receiverAuthorization();
  const records = new Map<string, ReceiverRecord>();
  const usedCursors = new Set<number>();
  let cursor = 0;
  const maxPages = positiveInteger("RECEIVER_API_MAX_PAGES", 100, 1000);
  const pause = positiveInteger("RECEIVER_API_PAUSE_MS", 3000, 60_000);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    if (usedCursors.has(cursor)) {
      throw new ReceiverUnavailableError("Receiver repeated a cursor");
    }
    usedCursors.add(cursor);
    const page = await receiverPage(base, authorization, cursor);
    if (
      !Number.isInteger(page.cursor) ||
      (page.cursor as number) < -1 ||
      (page.items !== null && !Array.isArray(page.items))
    ) {
      throw new ReceiverUnavailableError("Receiver returned an invalid page");
    }
    for (const raw of page.items ?? []) {
      const record = parseRecord(raw);
      const key = plateKey(record.lpn);
      if (records.has(key)) {
        throw new ReceiverUnavailableError("Receiver returned a duplicate plate");
      }
      records.set(key, record);
    }
    if (page.cursor === -1) {
      const loaded = [...records.values()];
      cache = {
        records: loaded,
        expiresAt:
          Date.now() +
          positiveInteger("RECEIVER_CACHE_TTL_SECONDS", 30, 300) * 1000,
      };
      return loaded;
    }
    cursor = page.cursor as number;
    await wait(pause);
  }
  throw new ReceiverUnavailableError("Receiver page limit exceeded");
}

export async function findReceiverSubscriptions(
  fragment: string,
): Promise<Subscription[]> {
  const query = latinPlateVariant(fragment);
  const today = moscowDate();
  const records = await loadReceiverRecords(fragment);
  return records
    .filter((record) => plateKey(record.lpn).includes(query))
    .map((record) => {
      const tariff = tariffByReceiverRate(record.rateId);
      return {
        plate: record.lpn,
        dateFrom: record.dateFrom,
        dateTo: record.dateTo,
        tariffName: tariff.name,
        accessPeriod: tariff.accessPeriod,
        status: periodStatus(record.dateFrom, record.dateTo, today),
      };
    });
}

