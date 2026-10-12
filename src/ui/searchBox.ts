import type { SearchIndex, SearchItem, SearchResult } from '../data/search';
import { h } from './dom';
import { icon } from './icons';

function describe(r: SearchResult): string {
  const { item } = r;
  const base = item.kind === 0 ? (item.ctx ? `Country in ${item.ctx}` : 'Country') : item.kind === 1 ? item.ctx : `City in ${item.ctx}`;
  return r.matched && r.matched !== item.name ? `${base} (${r.matched})` : base;
}

export interface SearchBoxOptions {
  getIndex: () => Promise<SearchIndex>;
  onPick: (item: SearchItem) => void;
  onError: (message: string) => void;
}

/** ARIA 1.2 combobox: a text input that controls a listbox of places. */
export class SearchBox {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private results: SearchResult[] = [];
  private activeIndex = -1;
  private index: SearchIndex | null = null;
  private pending = 0;

  constructor(private readonly opts: SearchBoxOptions) {
    this.list = h('ul', { id: 'search-results', class: 'search-results', attrs: { role: 'listbox', 'aria-label': 'Places' } });
    this.input = h('input', {
      id: 'search',
      class: 'search-input',
      attrs: {
        type: 'search',
        role: 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
        'aria-controls': 'search-results',
        autocomplete: 'off',
        spellcheck: 'false',
        maxlength: 100,
        placeholder: 'Search a country, state or city',
      },
      on: {
        focus: () => void this.ensureIndex(),
        input: () => this.schedule(),
        keydown: (e) => this.onKey(e),
        blur: () => window.setTimeout(() => this.close(), 120),
      },
    });
    this.el = h(
      'div',
      { class: 'search' },
      h('label', { class: 'visually-hidden', text: 'Search a country, state or city', attrs: { for: 'search' } }),
      h('span', { class: 'search-icon' }, icon('search', 18)),
      this.input,
      this.list,
    );
  }

  focus(): void {
    this.input.focus();
  }

  private async ensureIndex(): Promise<SearchIndex | null> {
    if (this.index) return this.index;
    try {
      this.index = await this.opts.getIndex();
      return this.index;
    } catch {
      this.opts.onError("Couldn't load the list of places. Check your connection and try again.");
      return null;
    }
  }

  private schedule(): void {
    window.cancelAnimationFrame(this.pending);
    this.pending = window.requestAnimationFrame(() => void this.run());
  }

  private async run(): Promise<void> {
    const q = this.input.value;
    if (!q.trim()) return this.close();
    const index = this.index ?? (await this.loading());
    if (!index || q !== this.input.value) return;
    this.results = index.query(q, 8);
    this.activeIndex = this.results.length ? 0 : -1;
    this.render(q);
  }

  private async loading(): Promise<SearchIndex | null> {
    this.list.replaceChildren(h('li', { class: 'search-note', text: 'Loading places…', attrs: { role: 'presentation' } }));
    this.open();
    return this.ensureIndex();
  }

  private render(q: string): void {
    if (!this.results.length) {
      this.list.replaceChildren(h('li', { class: 'search-note', text: `No place called “${q.trim()}”. Try another spelling.`, attrs: { role: 'presentation' } }));
      this.input.removeAttribute('aria-activedescendant');
      return this.open();
    }
    this.list.replaceChildren(
      ...this.results.map((r, i) =>
        h(
          'li',
          {
            id: `search-opt-${i}`,
            class: 'search-option',
            attrs: { role: 'option', 'aria-selected': i === this.activeIndex ? 'true' : 'false' },
            on: {
              pointerdown: (e) => {
                e.preventDefault();
                this.pick(i);
              },
            },
          },
          h('span', { class: 'search-name', text: r.item.name }),
          h('span', { class: 'search-context', text: describe(r) }),
        ),
      ),
    );
    this.syncActive();
    this.open();
  }

  private syncActive(): void {
    this.list.querySelectorAll('[role="option"]').forEach((el, i) => el.setAttribute('aria-selected', i === this.activeIndex ? 'true' : 'false'));
    if (this.activeIndex >= 0) {
      this.input.setAttribute('aria-activedescendant', `search-opt-${this.activeIndex}`);
      this.list.querySelector(`#search-opt-${this.activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }

  private onKey(e: KeyboardEvent): void {
    const n = this.results.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % n;
      this.syncActive();
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.activeIndex = (this.activeIndex - 1 + n) % n;
      this.syncActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.activeIndex >= 0) this.pick(this.activeIndex);
    } else if (e.key === 'Escape') {
      if (this.input.getAttribute('aria-expanded') === 'true') {
        e.preventDefault();
        this.close();
      } else this.input.value = '';
    }
  }

  private pick(i: number): void {
    const r = this.results[i];
    if (!r) return;
    this.input.value = '';
    this.close();
    this.opts.onPick(r.item);
  }

  private open(): void {
    this.list.classList.add('open');
    this.input.setAttribute('aria-expanded', 'true');
  }

  private close(): void {
    this.list.classList.remove('open');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.results = [];
    this.activeIndex = -1;
  }
}
