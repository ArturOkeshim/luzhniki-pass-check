import { requiredRuntimeValue, runtimeValue } from "./runtime-config";

const COOKIE_NAME = "luzhniki_guard_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_ACCOUNTS = 20;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ServiceAccount = {
  login: string;
  password: string;
};

function bytesToBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function serviceAccounts(): ServiceAccount[] {
  const accounts: ServiceAccount[] = [];
  for (let index = 1; index <= MAX_ACCOUNTS; index += 1) {
    const login = runtimeValue(`SERVICE_AUTH_LOGIN_${index}`);
    const password = runtimeValue(`SERVICE_AUTH_PASSWORD_${index}`);
    if (!login && !password) continue;
    if (!login || !password || login.length > 128 || password.length < 12) {
      throw new Error(`SERVICE_AUTH account ${index} is not configured securely`);
    }
    accounts.push({ login, password });
  }

  // Backward-compatible single account for existing deployments.
  if (accounts.length === 0) {
    const login = runtimeValue("SERVICE_AUTH_LOGIN");
    const password = runtimeValue("SERVICE_AUTH_PASSWORD");
    if (login || password) {
      if (!login || !password || login.length > 128 || password.length < 12) {
        throw new Error("Service credentials are not configured securely");
      }
      accounts.push({ login, password });
    }
  }

  const logins = new Set<string>();
  for (const account of accounts) {
    if (logins.has(account.login)) throw new Error("Duplicate service login");
    logins.add(account.login);
  }
  return accounts;
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = requiredRuntimeValue("SERVICE_SESSION_SECRET");
  if (secret.length < 32) throw new Error("SERVICE_SESSION_SECRET is too short");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function digest(value: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function sameSecret(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

function cookieValue(request: Request): string {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(value.join("="));
  }
  return "";
}

export async function verifyServiceCredentials(
  login: string,
  password: string,
): Promise<string | null> {
  const accounts = serviceAccounts();
  if (accounts.length === 0) throw new Error("Service accounts are not configured");
  const comparisons = await Promise.all(
    accounts.map(async (account) => {
      const [loginMatches, passwordMatches] = await Promise.all([
        sameSecret(login, account.login),
        sameSecret(password, account.password),
      ]);
      return loginMatches && passwordMatches ? account.login : null;
    }),
  );
  return comparisons.find((value) => value !== null) ?? null;
}

export async function createServiceSession(login: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const account = bytesToBase64Url(encoder.encode(login).buffer);
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)).buffer);
  const payload = `v2.${expiresAt}.${account}.${nonce}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    encoder.encode(payload),
  );
  return `${payload}.${bytesToBase64Url(signature)}`;
}

export async function isServiceAuthenticated(request: Request): Promise<boolean> {
  const token = cookieValue(request);
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  try {
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      base64UrlToBytes(parts[4]),
      encoder.encode(parts.slice(0, 4).join(".")),
    );
    if (!validSignature) return false;
    const login = decoder.decode(base64UrlToBytes(parts[2]));
    return serviceAccounts().some((account) => account.login === login);
  } catch {
    return false;
  }
}

export function serviceSessionCookie(token: string, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearServiceSessionCookie(secure: boolean): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

export function serviceAuthConfigured(): boolean {
  try {
    return serviceAccounts().length > 0 && Boolean(runtimeValue("SERVICE_SESSION_SECRET"));
  } catch {
    return false;
  }
}
