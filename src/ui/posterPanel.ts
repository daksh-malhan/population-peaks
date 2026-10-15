import type { PaletteId } from '../app/shareState';
import { PALETTES } from '../render/palettes';
import { h, nextId } from './dom';
import { icon } from './icons';

export type ExportFormat = 'portrait' | 'story' | 'print';

export interface PanelLabel {
  id: string;
  name: string;
  original: string;
}

export interface PanelState {
  title: string;
  titlePlaceholder: string;
  subtitle: string;
  subtitlePlaceholder: string;
  author: string;
  palette: PaletteId;
  height: number;
  scale: 'own' | 'same';
  radiusKm: number | null;
  labels: PanelLabel[];
  labelChoices: { id: string; name: string }[];
  canPrint: boolean;
  busy: boolean;
}

export interface PanelHandlers {
  onTitle(v: string): void;
  onSubtitle(v: string): void;
  onAuthor(v: string): void;
  onPalette(id: PaletteId): void;
  onHeight(v: number, final: boolean): void;
  onScale(v: 'own' | 'same'): void;
  onRadius(km: number, final: boolean): void;
  onLabelRename(id: string, name: string): void;
  onLabelHide(id: string): void;
  onLabelAdd(id: string): void;
  onResetView(): void;
  onExport(format: ExportFormat): void;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || nextId('f');
  control.id = id;
  const hintEl = hint ? h('span', { class: 'field-hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'field' }, h('label', { class: 'field-label', text: label, attrs: { for: id } }), control, hintEl);
}

/** Everything about the current poster: words, colours, spikes, area, labels, export. */
export class PosterPanel {
  readonly el: HTMLElement;
  private readonly title = h('input', { attrs: { type: 'text', maxlength: 80 } });
  private readonly subtitle = h('input', { attrs: { type: 'text', maxlength: 80 } });
  private readonly author = h('input', { attrs: { type: 'text', maxlength: 60, autocomplete: 'name' } });
  private readonly height = h('input', { attrs: { type: 'range', min: 0.25, max: 3, step: 0.05 } });
  private readonly heightOut = h('output', { class: 'field-value' });
  private readonly radius = h('input', { attrs: { type: 'range', min: 10, max: 100, step: 5 } });
  private readonly radiusOut = h('output', { class: 'field-value' });
  private readonly radiusGroup: HTMLElement;
  private readonly palettes = new Map<PaletteId, HTMLInputElement>();
  private readonly scales = new Map<'own' | 'same', HTMLInputElement>();
  private readonly labelList = h('ul', { class: 'label-list' });
  private readonly labelAdd = h('select', { attrs: { 'aria-label': 'City to label' } });
  private readonly labelAddRow: HTMLElement;
  private readonly formats = new Map<ExportFormat, HTMLInputElement>();
  private readonly printNote = h('span', { class: 'field-hint' });
  private readonly exportBtn: HTMLButtonElement;

  constructor(private readonly handlers: PanelHandlers) {
    this.title.addEventListener('input', () => handlers.onTitle(this.title.value));
    this.subtitle.addEventListener('input', () => handlers.onSubtitle(this.subtitle.value));
    this.author.addEventListener('input', () => handlers.onAuthor(this.author.value));
    this.height.addEventListener('input', () => {
      this.heightOut.value = `${Number(this.height.value).toFixed(2)}×`;
      handlers.onHeight(Number(this.height.value), false);
    });
    this.height.addEventListener('change', () => handlers.onHeight(Number(this.height.value), true));
    this.radius.addEventListener('input', () => {
      this.radiusOut.value = `${this.radius.value} km`;
      handlers.onRadius(Number(this.radius.value), false);
    });
    this.radius.addEventListener('change', () => handlers.onRadius(Number(this.radius.value), true));

    const paletteGroup = h('div', { class: 'swatches', attrs: { role: 'radiogroup', 'aria-label': 'Colours' } });
    for (const p of Object.values(PALETTES)) {
      const input = h('input', { class: 'visually-hidden', attrs: { type: 'radio', name: 'palette', value: p.id } });
      input.addEventListener('change', () => input.checked && handlers.onPalette(p.id));
      this.palettes.set(p.id, input);
      paletteGroup.append(h('label', { class: `swatch swatch-${p.id}` }, input, h('span', { class: 'swatch-chip', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'swatch-name', text: p.name })));
    }

    const scaleHint = h('span', { class: 'field-hint', id: nextId('scale-hint'), text: 'Same for all places compares heights and colours directly.' });
    const scaleGroup = h('div', { class: 'choice', attrs: { role: 'radiogroup', 'aria-label': 'Scale', 'aria-describedby': scaleHint.id } });
    for (const [value, text] of [['own', 'Each place on its own'], ['same', 'Same for all places']] as const) {
      const input = h('input', { attrs: { type: 'radio', name: 'scale', value } });
      input.addEventListener('change', () => input.checked && handlers.onScale(value));
      this.scales.set(value, input);
      scaleGroup.append(h('label', { class: 'choice-option' }, input, h('span', { text })));
    }

    this.radiusGroup = h(
      'section',
      { class: 'panel-group', attrs: { 'aria-label': 'Area' } },
      h('h2', { class: 'panel-heading', text: 'Area' }),
      h('div', { class: 'field field-range' }, h('label', { class: 'field-label', text: 'Area around the city', attrs: { for: 'radius' } }), this.radiusOut, this.radius),
    );
    this.radius.id = 'radius';
    this.height.id = 'height';

    this.labelAddRow = h(
      'div',
      { class: 'label-add' },
      this.labelAdd,
      h('button', { class: 'btn btn-quiet', text: 'Add label', attrs: { type: 'button' }, on: { click: () => this.labelAdd.value && handlers.onLabelAdd(this.labelAdd.value) } }),
    );

    const formatGroup = h('div', { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': 'Poster size' } });
    for (const [value, text, full] of [
      ['portrait', 'Post 4:5', 'Instagram post, 4:5'],
      ['story', 'Story 9:16', 'Story, 9:16'],
      ['print', 'Print 3×', 'Print, 3 times larger, 4:5'],
    ] as const) {
      const input = h('input', { class: 'visually-hidden', attrs: { type: 'radio', name: 'format', value, 'aria-label': full } });
      this.formats.set(value, input);
      formatGroup.append(h('label', { class: 'segment', attrs: { title: full } }, input, h('span', { text, attrs: { 'aria-hidden': 'true' } })));
    }
    this.formats.get('portrait')!.checked = true;
    this.exportBtn = h(
      'button',
      {
        class: 'btn btn-primary',
        attrs: { type: 'button' },
        on: {
          click: () => {
            const chosen = [...this.formats].find(([, i]) => i.checked)?.[0] ?? 'portrait';
            handlers.onExport(chosen);
          },
        },
      },
      icon('download', 18),
      h('span', { text: 'Export poster' }),
    );

    this.el = h(
      'aside',
      { class: 'panel', attrs: { 'aria-label': 'Poster settings' } },
      h(
        'section',
        { class: 'panel-group', attrs: { 'aria-label': 'Words' } },
        h('h2', { class: 'panel-heading', text: 'Words' }),
        field('Title', this.title),
        field('Subtitle', this.subtitle),
        field('Your name', this.author, 'Shown as “Author” on the poster. Leave empty to hide it.'),
      ),
      h('section', { class: 'panel-group', attrs: { 'aria-label': 'Colours' } }, h('h2', { class: 'panel-heading', text: 'Colours' }), paletteGroup),
      h(
        'section',
        { class: 'panel-group', attrs: { 'aria-label': 'Spikes' } },
        h('h2', { class: 'panel-heading', text: 'Spikes' }),
        h('div', { class: 'field field-range' }, h('label', { class: 'field-label', text: 'Spike height', attrs: { for: 'height' } }), this.heightOut, this.height),
        h('fieldset', { class: 'field' }, h('legend', { class: 'field-label', text: 'Scale' }), scaleGroup, scaleHint),
      ),
      this.radiusGroup,
      h(
        'section',
        { class: 'panel-group', attrs: { 'aria-label': 'Labels' } },
        h('h2', { class: 'panel-heading', text: 'Labels' }),
        this.labelList,
        this.labelAddRow,
        h('button', { class: 'btn btn-quiet', attrs: { type: 'button' }, on: { click: () => handlers.onResetView() } }, icon('reset', 16), h('span', { text: 'Reset to poster angle' })),
      ),
      h(
        'section',
        { class: 'panel-group panel-export', attrs: { 'aria-label': 'Export' } },
        h('h2', { class: 'panel-heading', text: 'Export' }),
        formatGroup,
        this.printNote,
        this.exportBtn,
      ),
    );
  }

  update(s: PanelState): void {
    const setVal = (el: HTMLInputElement, v: string) => {
      if (document.activeElement !== el && el.value !== v) el.value = v;
    };
    setVal(this.title, s.title);
    this.title.placeholder = s.titlePlaceholder;
    setVal(this.subtitle, s.subtitle);
    this.subtitle.placeholder = s.subtitlePlaceholder || 'Optional';
    setVal(this.author, s.author);
    this.author.placeholder = 'Optional';
    this.palettes.get(s.palette)!.checked = true;
    setVal(this.height, String(s.height));
    this.heightOut.value = `${s.height.toFixed(2)}×`;
    this.scales.get(s.scale)!.checked = true;
    this.radiusGroup.hidden = s.radiusKm === null;
    if (s.radiusKm !== null) {
      setVal(this.radius, String(s.radiusKm));
      this.radiusOut.value = `${s.radiusKm} km`;
    }

    this.labelList.replaceChildren(
      ...s.labels.map((l) => {
        const input = h('input', { attrs: { type: 'text', maxlength: 40, value: l.name, 'aria-label': `Label for ${l.original}` } });
        input.addEventListener('change', () => this.handlers.onLabelRename(l.id, input.value));
        return h(
          'li',
          { class: 'label-row' },
          input,
          h('button', { class: 'btn btn-quiet btn-small', text: 'Hide', attrs: { type: 'button', 'aria-label': `Hide ${l.original}` }, on: { click: () => this.handlers.onLabelHide(l.id) } }),
        );
      }),
    );
    this.labelAdd.replaceChildren(h('option', { text: 'Choose a city', attrs: { value: '' } }), ...s.labelChoices.map((c) => h('option', { text: c.name, attrs: { value: c.id } })));
    this.labelAddRow.hidden = s.labelChoices.length === 0;

    const print = this.formats.get('print')!;
    print.disabled = !s.canPrint;
    if (!s.canPrint && print.checked) this.formats.get('portrait')!.checked = true;
    this.printNote.textContent = s.canPrint ? '' : 'Print size needs a desktop browser with a large graphics buffer.';
    this.printNote.hidden = s.canPrint;
    this.exportBtn.disabled = s.busy;
    this.exportBtn.setAttribute('aria-busy', s.busy ? 'true' : 'false');
  }
}
