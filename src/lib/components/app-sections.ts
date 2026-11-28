/** The app's top-level sections, in header order (PHASE_3 "Navigation"). */
export const appSections = ['holidays', 'recipes', 'ingredients'] as const;

export type AppSection = (typeof appSections)[number];

/** The section a route belongs to: holiday pages count as Holidays. */
export function appSectionOf(routeId: string | null): AppSection | null {
  if (routeId === '/' || routeId?.startsWith('/holidays/')) return 'holidays';
  if (routeId === '/recipes' || routeId?.startsWith('/recipes/')) return 'recipes';
  if (routeId === '/ingredients' || routeId?.startsWith('/ingredients/')) return 'ingredients';
  return null;
}
