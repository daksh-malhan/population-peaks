import { formatDensity, formatPopulation } from '../app/format';
import { h, setText } from './dom';
import { icon } from './icons';

export interface CardView {
  /** Which place this is (not which data is loaded for it), so its card survives loading and radius changes. */
  key: string;
  name: string;
  status: 'loading' | 'ready' | 'error';
  population?: number;
  peakDensity?: number;
  peakNear?: string;
  thumb?: HTMLCanvasElement;
}

export interface GalleryHandlers {
  onSelect(index: number): void;
  onRemove(index: number): void;
  onAdd(): void;
}

interface CardDom {
  li: HTMLLIElement;
  card: HTMLButtonElement;
  remove: HTMLButtonElement;
  empty: HTMLSpanElement;
  preview: Element;
  name: HTMLSpanElement;
  stat: HTMLSpanElement;
  detail: HTMLSpanElement;
  index: number;
}

/**
 * The collection of places: small poster-shaped previews, one per card.
 * Cards are updated in place, so a focused button keeps focus while other cards finish loading.
 */
export class GalleryStrip {
  readonly el: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly addItem: HTMLLIElement;
  private readonly addButton: HTMLButtonElement;
  private cards = new Map<string, CardDom>();

  constructor(private readonly handlers: GalleryHandlers) {
    this.addButton = h(
      'button',
      { class: 'card card-add', attrs: { type: 'button' }, on: { click: () => this.handlers.onAdd() } },
      icon('plus', 22),
      h('span', { class: 'card-name', text: 'Add a place' }),
    );
    this.addItem = h('li', { class: 'card-item' }, this.addButton);
    this.list = h('ol', { class: 'gallery-list' }, this.addItem);
    this.el = h('section', { class: 'gallery', attrs: { 'aria-label': 'Your places' } }, this.list);
  }

  render(cards: CardView[], active: number): void {
    const next = new Map<string, CardDom>();
    const seen = new Map<string, number>();
    const order = cards.map((c, i) => {
      // A crafted link can list a place twice; counting repeats keeps every card's id unique.
      const n = seen.get(c.key) ?? 0;
      seen.set(c.key, n + 1);
      const id = `${c.key}#${n}`;
      const dom = this.cards.get(id) ?? this.create();
      this.update(dom, c, i, i === active);
      next.set(id, dom);
      return dom;
    });
    const heir = this.focusHeir(next, order);
    for (const [id, dom] of this.cards) if (!next.has(id)) dom.li.remove();
    // Moving a node drops its focus, so only nodes that are out of place move.
    [...order.map((d) => d.li), this.addItem].forEach((li, i) => {
      const at = this.list.children[i];
      if (at !== li) this.list.insertBefore(li, at ?? null);
    });
    this.cards = next;
    heir?.focus();
  }

  /** When the focused card is going away, the matching button of the card that takes its place, else "Add a place". */
  private focusHeir(next: Map<string, CardDom>, order: CardDom[]): HTMLElement | null {
    const focused = document.activeElement;
    if (!focused) return null;
    for (const [id, dom] of this.cards) {
      if (next.has(id) || !dom.li.contains(focused)) continue;
      const heir = order[Math.min(dom.index, order.length - 1)];
      if (!heir) return this.addButton;
      return focused === dom.remove ? heir.remove : heir.card;
    }
    return null;
  }

  private create(): CardDom {
    const empty = h('span', { class: 'card-thumb card-thumb-empty', attrs: { 'aria-hidden': 'true' } });
    const name = h('span', { class: 'card-name' });
    const stat = h('span', { class: 'card-stat' });
    const detail = h('span', { class: 'card-stat card-stat-muted' });
    const card = h('button', { class: 'card', attrs: { type: 'button' }, on: { click: () => this.handlers.onSelect(dom.index) } }, empty, name, stat, detail);
    const remove = h('button', { class: 'card-remove', attrs: { type: 'button' }, on: { click: () => this.handlers.onRemove(dom.index) } }, icon('close', 16));
    const dom: CardDom = { li: h('li', { class: 'card-item' }, card, remove), card, remove, empty, preview: empty, name, stat, detail, index: 0 };
    return dom;
  }

  private update(dom: CardDom, c: CardView, index: number, active: boolean): void {
    dom.index = index;
    dom.card.classList.toggle('card-active', active);
    if (active) dom.card.setAttribute('aria-current', 'true');
    else dom.card.removeAttribute('aria-current');
    const preview = c.thumb ?? dom.empty;
    if (preview !== dom.preview) {
      preview.classList.add('card-thumb');
      preview.setAttribute('aria-hidden', 'true');
      dom.preview.replaceWith(preview);
      dom.preview = preview;
    }
    setText(dom.name, c.name);
    dom.remove.setAttribute('aria-label', `Remove ${c.name}`);
    dom.remove.title = `Remove ${c.name}`;
    const ready = c.status === 'ready' && c.population !== undefined;
    dom.stat.classList.toggle('card-stat-muted', !ready);
    setText(dom.stat, ready ? `${formatPopulation(c.population!)} people` : c.status === 'error' ? "Couldn't load, select to retry" : 'Loading…');
    const detail = ready && c.peakDensity ? `Peak ${formatDensity(c.peakDensity)}${c.peakNear ? ` near ${c.peakNear}` : ''}` : '';
    setText(dom.detail, detail);
    dom.detail.hidden = !detail;
  }
}
