import { h } from './dom';

/** Short, polite status messages announced to screen readers. */
export class Toaster {
  readonly el = h('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });

  show(message: string, kind: 'info' | 'error' = 'info', ms = 4500): void {
    const t = h('p', { class: `toast toast-${kind}`, text: message });
    this.el.append(t);
    while (this.el.childElementCount > 3) this.el.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), ms);
  }
}
