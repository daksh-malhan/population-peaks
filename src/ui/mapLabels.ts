import { type Anchor, type Placement, placeLabels } from '../render/labels';
import { h } from './dom';

export interface LabelPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  visible: boolean;
}

const GAP = 22;

/**
 * City labels over the 3D view in the poster's style: uppercase name, a leader line,
 * and a dot on the spike's tip. Decorative (aria-hidden); the stage summary carries the text.
 */
export class MapLabels {
  readonly el = h('div', { class: 'map-labels', attrs: { 'aria-hidden': 'true' } });
  private readonly nodes = new Map<string, { root: HTMLElement; text: HTMLElement; line: HTMLElement; width: number; name: string }>();

  update(points: LabelPoint[], frame: { width: number; height: number }): void {
    const seen = new Set<string>();
    const anchors: Anchor[] = [];
    for (const p of points) {
      if (!p.visible) continue;
      let node = this.nodes.get(p.id);
      if (!node || node.name !== p.name) {
        node?.root.remove();
        const text = h('span', { class: 'map-label-text', text: p.name });
        const line = h('span', { class: 'map-label-line' });
        const root = h('div', { class: 'map-label' }, line, h('span', { class: 'map-label-dot' }), text);
        this.el.append(root);
        node = { root, text, line, width: 0, name: p.name };
        this.nodes.set(p.id, node);
      }
      if (!node.width) node.width = Math.ceil(node.text.getBoundingClientRect().width) || p.name.length * 9;
      anchors.push({ id: p.id, x: p.x, y: p.y, w: node.width, h: 16 });
      seen.add(p.id);
    }
    const placed = new Map<string, Placement>(placeLabels(anchors, frame, GAP).map((pl) => [pl.id, pl]));
    for (const [id, node] of this.nodes) {
      const pl = placed.get(id);
      const a = anchors.find((x) => x.id === id);
      if (!seen.has(id) || !pl || !a || !pl.visible) {
        node.root.hidden = true;
        continue;
      }
      node.root.hidden = false;
      node.root.style.transform = `translate(${a.x}px, ${a.y}px)`;
      node.text.style.transform = `translate(${pl.x - a.x}px, ${pl.y - a.y}px)`;
      const ls = node.line.style;
      if (pl.side === 'above' || pl.side === 'below') {
        const top = pl.side === 'above' ? pl.y + a.h - a.y : 0;
        const len = pl.side === 'above' ? -top : pl.y - a.y;
        ls.width = '1.5px';
        ls.height = `${Math.max(0, len)}px`;
        ls.transform = `translate(-0.75px, ${pl.side === 'above' ? top : 0}px)`;
      } else {
        const len = pl.side === 'right' ? pl.x - a.x - 4 : a.x - (pl.x + a.w) - 4;
        ls.height = '1.5px';
        ls.width = `${Math.max(0, len)}px`;
        ls.transform = `translate(${pl.side === 'right' ? 4 : -4 - Math.max(0, len)}px, -0.75px)`;
      }
    }
  }

  clear(): void {
    for (const n of this.nodes.values()) n.root.remove();
    this.nodes.clear();
  }
}
