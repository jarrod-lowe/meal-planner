// Display format for quantities (DESIGN §1): at most 2 decimal places, with
// trailing zeros trimmed. The engine and storage never round.

const quantityFormat = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 2,
  useGrouping: false
});

/** `1.5` → `"1.5"`, `1/3` → `"0.33"`, `2` → `"2"`. */
export function formatQuantity(quantity: number): string {
  return quantityFormat.format(quantity);
}
