import type { components } from '#lib/api/types.js';

export type ShopSection = components['schemas']['ShopSection'];

/** Shop sections in the order they appear on a shopping list (DESIGN §2.1). */
export const SHOP_SECTIONS = [
  'produce',
  'bakery',
  'meat-fish',
  'dairy',
  'frozen',
  'pantry',
  'drinks',
  'household',
  'other'
] as const satisfies readonly ShopSection[];

// Fails to compile if the openapi enum gains a section missing from the list.
type Missing = Exclude<ShopSection, (typeof SHOP_SECTIONS)[number]>;
const allSectionsListed: [Missing] extends [never] ? true : Missing = true;
void allSectionsListed;
