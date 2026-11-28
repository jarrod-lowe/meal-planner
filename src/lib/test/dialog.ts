// jsdom has no `showModal()` or `close()` on <dialog>. These stand-ins open and
// close it, and fire `close` like a browser does. Import in component tests.
const proto = HTMLDialogElement.prototype;

if (!('showModal' in proto)) {
  Object.assign(proto, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    }
  });
}

if (!('close' in proto)) {
  Object.assign(proto, {
    close(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }
  });
}
