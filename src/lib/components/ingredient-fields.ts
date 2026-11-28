// The fields of an ingredient the user edits, and their checks (DESIGN §5.2).
import type { ShopSection } from '#lib/model/sections.js';
import { maxNameLength } from './names.js';

export interface IngredientFields {
  name: string;
  unit: string;
  shopSection: ShopSection;
}

export const maxUnitLength = 20;

export interface IngredientErrors {
  name?: 'nameRequired' | 'nameTooLong';
  unit?: 'unitRequired' | 'unitTooLong';
}

/** The `ingredientForm.errors.*` message for each bad field. */
export function ingredientErrors({ name, unit }: { name: string; unit: string }): IngredientErrors {
  const errors: IngredientErrors = {};
  const trimmedName = name.trim();
  const trimmedUnit = unit.trim();
  if (!trimmedName) errors.name = 'nameRequired';
  else if (trimmedName.length > maxNameLength) errors.name = 'nameTooLong';
  if (!trimmedUnit) errors.unit = 'unitRequired';
  else if (trimmedUnit.length > maxUnitLength) errors.unit = 'unitTooLong';
  return errors;
}
