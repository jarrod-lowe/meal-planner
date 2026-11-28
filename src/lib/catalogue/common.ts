import data from '#data/common-ingredients.json';
import type { CommonIngredient } from './search.js';

/** The common ingredients list, checked by `common-ingredients.test.ts`. */
export const COMMON_INGREDIENTS: readonly CommonIngredient[] = data as CommonIngredient[];
