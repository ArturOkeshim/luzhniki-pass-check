type RuntimeBindings = Record<string, string | undefined>;

let workerBindings: RuntimeBindings = {};

export function setRuntimeBindings(
  value: Record<string, unknown> | null | undefined,
): void {
  workerBindings = Object.fromEntries(
    Object.entries(value ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function runtimeValue(name: string, fallback = ""): string {
  const value = workerBindings[name] ?? process.env[name] ?? fallback;
  return typeof value === "string" ? value.trim() : fallback;
}

export function requiredRuntimeValue(name: string): string {
  const value = runtimeValue(name);
  if (!value) throw new Error(`Missing runtime setting: ${name}`);
  return value;
}
