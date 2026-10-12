/**
 * The only way this app builds DOM: elements, attributes and text nodes — never HTML strings.
 * `style` and `on*` attributes are refused (CSP blocks them; use CSSOM and listeners instead).
 */
type Child = Node | string | number | null | undefined | false;
type Listeners = { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Listeners;
}

function setAttrs(el: Element, attrs: Props['attrs']): void {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'style' || /^on/i.test(k)) throw new Error(`refusing to set attribute "${k}"`);
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  setAttrs(el, props.attrs);
  for (const [type, fn] of Object.entries(props.on ?? {})) el.addEventListener(type, fn as EventListener);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string | number>, ...children: Element[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (/^on/i.test(k)) throw new Error(`refusing to set attribute "${k}"`);
    el.setAttribute(k, String(v));
  }
  el.append(...children);
  return el as SVGElement;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;
