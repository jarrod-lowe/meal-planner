// All user-facing text (DESIGN §7.1). Components read it through `t()`.
export const en = {
  app: {
    title: 'Meal planner'
  },
  home: {
    placeholder: 'Plan meals, shopping and stock for a holiday. Coming soon.'
  }
} as const;

type Messages = { readonly [key: string]: string | Messages };

/** Dotted paths to the string leaves of `M`, e.g. `'app.title'`. */
export type MessageKey<M> = {
  [K in keyof M & string]: M[K] extends string ? K : `${K}.${MessageKey<M[K]>}`;
}[keyof M & string];

export type Params = Readonly<Record<string, string | number>>;

/**
 * Builds a `t()` for a message object. `{name}` placeholders are replaced from
 * `params`; a placeholder with no matching param is left as-is, so a missing
 * value shows up visibly in the UI rather than crashing the page.
 */
export function translator<M extends Messages>(messages: M) {
  return (key: MessageKey<M>, params?: Params): string => {
    let node: string | Messages | undefined = messages;
    for (const part of key.split('.')) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    // Unreachable for well-typed keys; fall back to the key itself.
    if (typeof node !== 'string') return key;
    return node.replace(/\{(\w+)\}/g, (match, name: string) =>
      params && Object.hasOwn(params, name) ? String(params[name]) : match
    );
  };
}

export const t = translator(en);
