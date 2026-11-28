// A wall-clock `LocalDateTime` in a time zone (DESIGN §1), from the platform's
// time zone data. Plain TypeScript, so the formatter cache isn't reactive state.
import type { LocalDateTime } from '#lib/engine/index.js';

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** `date` (or milliseconds since the epoch) as `"YYYY-MM-DDTHH:mm"` in `timeZone`. */
export function localNow(date: Date | number, timeZone: string): LocalDateTime {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatFor(timeZone).formatToParts(date)) parts[part.type] = part.value;
  const { year = '', month = '', day = '', hour = '', minute = '' } = parts;
  return `${year.padStart(4, '0')}-${month}-${day}T${hour}:${minute}`;
}
