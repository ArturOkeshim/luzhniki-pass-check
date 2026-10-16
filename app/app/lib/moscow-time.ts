const MOSCOW_TIME_ZONE = "Europe/Moscow";

export function moscowDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isActivePeriod(
  dateFrom: string,
  dateTo: string,
  today = moscowDate(),
): boolean {
  return dateFrom <= today && today <= dateTo;
}

export function periodStatus(
  dateFrom: string,
  dateTo: string,
  today = moscowDate(),
): "active" | "expired" | "future" {
  if (today < dateFrom) return "future";
  if (today > dateTo) return "expired";
  return "active";
}

export function subtractIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - Math.max(0, days));
  return date.toISOString().slice(0, 10);
}

