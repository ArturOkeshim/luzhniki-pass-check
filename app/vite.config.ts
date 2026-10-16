import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { connectorPreview } from "./build/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const LOCAL_RUNTIME_KEYS = [
  "B24_WEBHOOK_URL",
  "B24_PORTAL_HOST",
  "B24_SUBSCRIPTION_CATEGORY_ID",
  "B24_SUBSCRIPTION_PAID_STAGE_ID",
  "B24_EXCLUDED_PRODUCT_IDS",
  "B24_SUBSCRIPTION_DURATION_DAYS",
  "SERVICE_AUTH_LOGIN",
  "SERVICE_AUTH_PASSWORD",
  "SERVICE_AUTH_LOGIN_1",
  "SERVICE_AUTH_PASSWORD_1",
  "SERVICE_AUTH_LOGIN_2",
  "SERVICE_AUTH_PASSWORD_2",
  "SERVICE_AUTH_LOGIN_3",
  "SERVICE_AUTH_PASSWORD_3",
  "SERVICE_AUTH_LOGIN_4",
  "SERVICE_AUTH_PASSWORD_4",
  "SERVICE_AUTH_LOGIN_5",
  "SERVICE_AUTH_PASSWORD_5",
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
] as const;

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./build/sites-worker.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const localRuntimeVars = Object.fromEntries(
    LOCAL_RUNTIME_KEYS.flatMap((key) => {
      const value = (process.env[key] ?? fileEnv[key])?.trim();
      return value ? [[key, value]] : [];
    }),
  );

  return {
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: false }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve" && Object.keys(localRuntimeVars).length > 0
            ? { vars: localRuntimeVars }
            : {}),
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./build/connector-preview-worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
