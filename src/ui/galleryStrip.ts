import { formatDensity, formatPopulation } from '../app/format';
import { h } from './dom';
import { icon } from './icons';

export interface CardView {
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

/** The collection of places: small poster-shaped previews, one per card. */
export class GalleryStrip {
  readonly el: HTMLElement;
  private readonly list: HTMLOListElement;

  constructor(private readonly handlers: GalleryHandlers) {
    this.list = h('ol', { class: 'gallery-list' });
    this.el = h('section', { class: 'gallery', attrs: { 'aria-label': 'Your places' } }, this.list);
  }

  render(cards: CardView[], active: number): void {
    const items = cards.map((c, i) => {
      const stats =
        c.status === 'ready' && c.population !== undefined
          ? [
              h('span', { class: 'card-stat', text: `${formatPopulation(c.population)} people` }),
              c.peakDensity ? h('span', { class: 'card-stat card-stat-muted', text: `Peak ${formatDensity(c.peakDensity)}${c.peakNear ? ` near ${c.peakNear}` : ''}` }) : null,
            ]
          : [h('span', { class: 'card-stat card-stat-muted', text: c.status === 'error' ? "Couldn't load, select to retry" : 'Loading…' })];
      const preview = c.thumb ?? h('span', { class: 'card-thumb-empty' });
      preview.classList.add('card-thumb');
      preview.setAttribute('aria-hidden', 'true');
      return h(
        'li',
        { class: 'card-item' },
        h(
          'button',
          {
            class: `card${i === active ? ' card-active' : ''}`,
            attrs: { type: 'button', 'aria-current': i === active ? 'true' : undefined },
            on: { click: () => this.handlers.onSelect(i) },
          },
          preview,
          h('span', { class: 'card-name', text: c.name }),
          ...stats,
        ),
        h(
          'button',
          { class: 'card-remove', attrs: { type: 'button', 'aria-label': `Remove ${c.name}`, title: `Remove ${c.name}` }, on: { click: () => this.handlers.onRemove(i) } },
          icon('close', 16),
        ),
      );
    });
    const add = h(
      'li',
      { class: 'card-item' },
      h('button', { class: 'card card-add', attrs: { type: 'button' }, on: { click: () => this.handlers.onAdd() } }, icon('plus', 22), h('span', { class: 'card-name', text: 'Add a place' })),
    );
    this.list.replaceChildren(...items, add);
  }
}
