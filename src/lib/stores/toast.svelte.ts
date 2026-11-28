// Short messages shown over the page, e.g. a save that failed or a version
// conflict (DESIGN §7.3). `Toasts.svelte` renders them in a live region.

export type ToastKind = 'error' | 'info';

export interface ToastAction {
  /** Already translated. */
  readonly label: string;
  readonly run: () => void;
}

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  /** Already translated. */
  readonly message: string;
  readonly action?: ToastAction;
}

export interface ToastOptions {
  /** How long an info toast with no action stays up. Errors and actions stay until dismissed. */
  readonly infoTimeoutMs?: number;
}

export class Toasts {
  items = $state.raw<readonly Toast[]>([]);

  readonly #infoTimeoutMs: number;
  #nextId = 1;

  constructor(options: ToastOptions = {}) {
    this.#infoTimeoutMs = options.infoTimeoutMs ?? 6000;
  }

  error(message: string, action?: ToastAction): number {
    return this.#show('error', message, action);
  }

  info(message: string, action?: ToastAction): number {
    const id = this.#show('info', message, action);
    // Anything to act on stays up, so nobody has to beat a timer (WCAG 2.2.1).
    if (!action) setTimeout(() => this.dismiss(id), this.#infoTimeoutMs);
    return id;
  }

  dismiss(id: number) {
    if (this.items.some((toast) => toast.id === id)) {
      this.items = this.items.filter((toast) => toast.id !== id);
    }
  }

  /** Runs the toast's action, then dismisses it. */
  act(id: number) {
    const toast = this.items.find((item) => item.id === id);
    this.dismiss(id);
    toast?.action?.run();
  }

  clear() {
    this.items = [];
  }

  #show(kind: ToastKind, message: string, action: ToastAction | undefined): number {
    const id = this.#nextId++;
    this.items = [...this.items, action ? { id, kind, message, action } : { id, kind, message }];
    return id;
  }
}

export const toasts = new Toasts();
