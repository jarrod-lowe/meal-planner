// Display formats for `LocalDate`s (DESIGN §1). A LocalDate has no time zone,
// so it's formatted as a UTC date, which never shifts it a day either way.

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

function toDate(localDate: string): Date {
  const [year = 0, month = 1, day = 1] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** `"2027-01-01"` → `"1 Jan 2027"`. */
export function formatDate(localDate: string): string {
  return dateFormat.format(toDate(localDate));
}

/** `"2026-12-26"`, `"2027-01-02"` → `"26 Dec 2026 – 2 Jan 2027"`, sharing what the two have in common. */
export function formatDateRange(start: string, end: string): string {
  // ICU puts thin and no-break spaces around the dash; plain spaces read the same.
  return dateFormat.formatRange(toDate(start), toDate(end)).replace(/\s+/gu, ' ');
}

const shortDateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
});

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
});

/** `"2027-01-01"` → `"1 Jan"`, as in suggested meal names. */
export function formatShortDate(localDate: string): string {
  return shortDateFormat.format(toDate(localDate));
}

/** `"2026-12-26"` → `"Sat 26 Dec"`, for the planner's rows. */
export function formatDay(localDate: string): string {
  return dayFormat.format(toDate(localDate)).replace(',', '');
}
