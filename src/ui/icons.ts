import { svg } from './dom';

// 24px stroke icons, drawn for this project.
const PATHS: Record<string, string[]> = {
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z', 'm20 20-4.8-4.8'],
  shuffle: ['M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6C14.3 16 15.5 17 17.5 17H21', 'm18 14 3 3-3 3', 'M3 17h3.5c1.4 0 2.4-.5 3.2-1.4', 'M14.3 8.4c.8-.9 1.8-1.4 3.2-1.4H21', 'm18 4 3 3-3 3'],
  link: ['M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1', 'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5', 'M12 7.5v.01'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  reset: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v5h5'],
  peaks: ['M2 20h20', 'M5 20 9 6l3 9', 'm11 20 4-12 4 12'],
};

export function icon(name: keyof typeof PATHS, size = 20): SVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    ...(PATHS[name] ?? []).map((d) => svg('path', { d })),
  );
}
