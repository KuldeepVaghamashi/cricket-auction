/**
 * Auction scheduled start: `datetime-local` values are wall-clock in the admin's browser.
 * Sending them raw to the server makes Node interpret them as UTC midnight-ish or wrong zone.
 * Always convert to ISO (UTC instant) in the browser before POST/PUT.
 */
export function datetimeLocalValueToIsoUtc(datetimeLocal: string): string | null {
  const trimmed = datetimeLocal?.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Parse auction `date` from API (ISO string or legacy Mongo shape) to UTC ms. */
export function auctionDateToUtcMs(dateField: unknown): number {
  if (dateField == null) return NaN;
  if (typeof dateField === "string") {
    const t = new Date(dateField).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  if (typeof dateField === "object" && dateField !== null && "$date" in dateField) {
    const inner = (dateField as { $date: string | number }).$date;
    const t = new Date(inner).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  if (dateField instanceof Date) {
    const t = dateField.getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

/** Rich local display for viewer / admin (includes timezone abbreviation). */
export function formatAuctionStartLocal(utcMs: number, locale?: string): string {
  if (!Number.isFinite(utcMs)) return "";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(utcMs));
}
