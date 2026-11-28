// `LocalDate` arithmetic (DESIGN §1), on `"YYYY-MM-DD"` strings. A LocalDate
// has no time zone, so it's worked out as a UTC date, which never shifts it.

const dayMs = 86_400_000;

function toUtc(localDate: string): number {
  const [year = 0, month = 1, day = 1] = localDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `"2026-12-31"`, 1 → `"2027-01-01"`. */
export function addDays(localDate: string, days: number): string {
  return fromUtc(toUtc(localDate) + days * dayMs);
}

/** Every date from `start` to `end`, inclusive; none if `end` is before `start`. */
export function datesFrom(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let at = toUtc(start), last = toUtc(end); at <= last; at += dayMs) dates.push(fromUtc(at));
  return dates;
}

/** Whether `value` is a real date written as `"YYYY-MM-DD"`. */
export function isLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && fromUtc(toUtc(value)) === value;
}
