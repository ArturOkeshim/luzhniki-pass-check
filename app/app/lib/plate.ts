const latinToCyrillic: Record<string, string> = {
  A: "А",
  B: "В",
  E: "Е",
  K: "К",
  M: "М",
  H: "Н",
  O: "О",
  P: "Р",
  C: "С",
  T: "Т",
  Y: "У",
  X: "Х",
};

const cyrillicToLatin = Object.fromEntries(
  Object.entries(latinToCyrillic).map(([latin, cyrillic]) => [cyrillic, latin]),
) as Record<string, string>;

export function normalizePlateFragment(input: unknown): string {
  if (typeof input !== "string" || input.length > 32) {
    throw new Error("Введите корректный ГРН.");
  }
  const compact = input.toUpperCase().replace(/[\s\-.]/gu, "");
  const normalized = [...compact]
    .map((character) => latinToCyrillic[character] ?? character)
    .join("");
  if (
    normalized.length < 3 ||
    normalized.length > 12 ||
    !/^[0-9АВЕКМНОРСТУХ]+$/u.test(normalized)
  ) {
    throw new Error("Введите не менее трёх символов ГРН.");
  }
  return normalized;
}

export function latinPlateVariant(value: string): string {
  return [...value]
    .map((character) => cyrillicToLatin[character] ?? character)
    .join("");
}

export function displayPlate(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[\s-]/gu, "").slice(0, 16);
}

export function plateKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return latinPlateVariant(
    [...value.toUpperCase().replace(/[\s\-.]/gu, "")]
      .map((character) => latinToCyrillic[character] ?? character)
      .join(""),
  );
}

export function isoDate(value: unknown): string {
  if (typeof value !== "string") return "";
  return /^(\d{4}-\d{2}-\d{2})/u.exec(value.trim())?.[1] ?? "";
}

export function receiverDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value.trim());
  if (!match) return "";
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso
    ? iso
    : "";
}

export function inclusiveEndDate(start: string, durationDays: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Math.max(1, durationDays) - 1);
  return date.toISOString().slice(0, 10);
}
