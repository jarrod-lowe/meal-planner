/** The holiday's sections (DESIGN §7.2), in navigation order. */
export const holidaySections = ['overview', 'plan', 'trips', 'stock', 'people'] as const;

export type HolidaySection = (typeof holidaySections)[number];
