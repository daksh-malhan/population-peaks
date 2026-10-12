import { h } from './dom';
import { icon } from './icons';

export interface BorderChoice {
  value: string;
  label: string;
}

const link = (href: string, text: string) => h('a', { text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });

/** About, credits, privacy and the border setting, in a native modal dialog. */
export class AboutDialog {
  readonly el: HTMLDialogElement;
  private readonly borders: HTMLSelectElement;

  constructor(choices: BorderChoice[], current: string, onBorders: (value: string) => void, repoUrl: string) {
    this.borders = h('select', { id: 'borders' }, ...choices.map((c) => h('option', { text: c.label, attrs: { value: c.value } })));
    this.borders.value = current;
    this.borders.addEventListener('change', () => onBorders(this.borders.value));
    this.el = h(
      'dialog',
      { class: 'about', attrs: { 'aria-labelledby': 'about-title' } },
      h(
        'div',
        { class: 'about-body' },
        h('button', { class: 'icon-btn about-close', attrs: { type: 'button', 'aria-label': 'Close' }, on: { click: () => this.el.close() } }, icon('close')),
        h('h2', { id: 'about-title', text: 'About population peaks' }),
        h('p', { text: 'Pick any country, state or city to see where its people live as a 3D landscape: the taller and brighter the spike, the more people per square kilometre. Drag to turn the map, then export a poster.' }),
        h('h3', { text: 'Borders' }),
        h('p', { text: 'Some borders are disputed. By default the map follows the official view of the country your device’s time zone is in, where one exists, and otherwise shows who actually controls each area.' }),
        h('div', { class: 'field' }, h('label', { class: 'field-label', text: 'Borders to draw', attrs: { for: 'borders' } }), this.borders),
        h('h3', { text: 'Data' }),
        h(
          'ul',
          { class: 'credits' },
          h('li', {}, 'Population: ', link('https://data.humdata.org/dataset/kontur-population-dataset', 'Kontur Population 2023'), ', 400 m hexagons, CC BY 4.0.'),
          h('li', {}, 'Borders: ', link('https://www.naturalearthdata.com/', 'Natural Earth'), ', public domain.'),
          h('li', {}, 'Cities: ', link('https://www.geonames.org/', 'GeoNames'), ', CC BY 4.0.'),
          h('li', {}, 'Typeface: Sora, SIL Open Font License.'),
          h('li', {}, 'Inspired by the population maps of ', link('https://www.instagram.com/tulparmaps/', 'Tulparmaps'), '.'),
        ),
        h('p', { class: 'muted', text: 'Population numbers are model estimates; small places and borders are approximate.' }),
        h('h3', { text: 'Privacy' }),
        h('p', { text: 'No accounts, no cookies, no tracking. Your gallery is saved only in this browser, and a link you share carries the gallery inside it.' }),
        h('p', {}, link(repoUrl, 'Source code on GitHub'), ' (MIT licence)'),
      ),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  open(): void {
    this.el.showModal();
  }

  setBorder(value: string): void {
    this.borders.value = value;
  }
}
