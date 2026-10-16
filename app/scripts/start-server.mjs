import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadEnv } from "vite";
import { projectRoot } from "./sites-env.mjs";

const STATIC_RUNTIME_KEYS = [
  "B24_WEBHOOK_URL",
  "B24_PORTAL_HOST",
  "B24_SUBSCRIPTION_CATEGORY_ID",
  "B24_SUBSCRIPTION_PAID_STAGE_ID",
  "B24_EXCLUDED_PRODUCT_IDS",
  "B24_SUBSCRIPTION_DURATION_DAYS",
  "SERVICE_AUTH_LOGIN",
  "SERVICE_AUTH_PASSWORD",
  "SERVICE_SESSION_SECRET",
  "RECEIVER_GATEWAY_URL",
  "RECEIVER_GATEWAY_HOST",
  "RECEIVER_GATEWAY_TOKEN",
  "RECEIVER_API_URL",
  "RECEIVER_API_HOSTS",
  "RECEIVER_API_USER",
  "RECEIVER_API_PASSWORD",
  "RECEIVER_API_PAUSE_MS",
  "RECEIVER_API_MAX_PAGES",
  "RECEIVER_CACHE_TTL_SECONDS",
  "RECEIVER_SIDECAR_URL",
];

const ACCOUNT_RUNTIME_KEYS = Array.from({ length: 20 }, (_, index) => index + 1)
  .flatMap((index) => [
    `SERVICE_AUTH_LOGIN_${index}`,
    `SERVICE_AUTH_PASSWORD_${index}`,
  ]);

const runtimeKeys = [...STATIC_RUNTIME_KEYS, ...ACCOUNT_RUNTIME_KEYS];
const runtimeRoot = path.resolve(
  process.env.SITES_RUNTIME_ROOT || path.join(projectRoot, ".sites-runtime"),
);
const baseConfigPath = path.join(projectRoot, "dist", "server", "wrangler.json");
const runtimeConfigPath = path.join(runtimeRoot, "wrangler.runtime.json");
const persistPath = path.join(runtimeRoot, "wrangler-state");
const fileEnv = loadEnv("production", projectRoot, "");

const vars = Object.fromEntries(
  runtimeKeys.flatMap((key) => {
    const value = (process.env[key] ?? fileEnv[key])?.trim();
    return value ? [[key, value]] : [];
  }),
);

const baseConfig = JSON.parse(readFileSync(baseConfigPath, "utf8"));
baseConfig.main = path.join(projectRoot, "dist", "server", "index.js");
baseConfig.assets = {
  ...(baseConfig.assets ?? {}),
  directory: path.join(projectRoot, "dist", "client"),
};
baseConfig.vars = vars;

mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
mkdirSync(persistPath, { recursive: true, mode: 0o700 });
writeFileSync(runtimeConfigPath, `${JSON.stringify(baseConfig)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
chmodSync(runtimeConfigPath, 0o600);

const port = process.env.SERVICE_PORT?.trim() || "8788";
if (!/^\d{2,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("SERVICE_PORT must be a valid TCP port");
}

const childEnv = { ...process.env };
for (const key of runtimeKeys) delete childEnv[key];
// Wrangler otherwise prints every binding value to stdout, including secrets.
childEnv.WRANGLER_LOG = "error";

const wranglerPath = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const child = spawn(
  process.execPath,
  [
    wranglerPath,
    "dev",
    "--config",
    runtimeConfigPath,
    "--local",
    "--persist-to",
    persistPath,
    "--ip",
    "127.0.0.1",
    "--port",
    port,
    "--inspector-port",
    "0",
  ],
  { cwd: projectRoot, env: childEnv, stdio: "inherit" },
);

child.on("error", (error) => {
  console.error("Unable to start the application server:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

