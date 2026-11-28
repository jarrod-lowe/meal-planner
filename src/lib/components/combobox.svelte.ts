// Keyboard and open state for a WAI-ARIA 1.2 combobox: an input that controls
// a listbox, with the active option shown through `aria-activedescendant`
// (DESIGN §7.6). The component renders the options; this tracks which is
// active and turns keys into choices.
export class Combobox {
  /** The user wants the list shown (it's also hidden while there's nothing to show). */
  open = $state(false);
  /** The active option's index, or -1 for none. */
  active = $state(-1);

  readonly #count: () => number;
  readonly #choose: (index: number) => void;

  constructor(count: () => number, choose: (index: number) => void) {
    this.#count = count;
    this.#choose = choose;
  }

  /** The text changed: show the list, with nothing active yet. */
  input() {
    this.open = true;
    this.active = -1;
  }

  close() {
    this.open = false;
    this.active = -1;
  }

  /** Handles the input's keys; returns whether it used the key. */
  keydown(event: Pick<KeyboardEvent, 'key' | 'preventDefault'>): boolean {
    const count = this.#count();
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (count === 0) return false;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        if (!this.open || this.active === -1) {
          this.open = true;
          this.active = step === 1 ? 0 : count - 1;
        } else {
          this.active = (this.active + step + count) % count;
        }
        return true;
      }
      case 'Enter': {
        if (!this.open || this.active < 0 || this.active >= count) return false;
        event.preventDefault();
        const index = this.active;
        this.close();
        this.#choose(index);
        return true;
      }
      case 'Escape': {
        if (!this.open) return false;
        event.preventDefault();
        this.close();
        return true;
      }
      default:
        return false;
    }
  }
}
