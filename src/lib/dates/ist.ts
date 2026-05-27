/** Returns YYYY-MM-DD in Asia/Kolkata (IST), optionally offset by whole days. */
export function getISTDateString(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getTomorrowISTDateString(): string {
  return getISTDateString(1);
}

/** Parses YYYY-MM-DD into a Date at local midnight for calendar use. */
export function parseISODateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}
