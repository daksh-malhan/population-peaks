import type { HtmlTagDescriptor, Plugin } from 'vite';

// GitHub Pages cannot send response headers, so the policy ships as a <meta> tag.
// That covers every fetch directive; frame-ancestors, report-uri and sandbox are
// ignored in meta, which is a documented limit of the hosting choice.
const DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
};

export function cspContent(): string {
  return Object.entries(DIRECTIVES)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

export function securityMeta(): HtmlTagDescriptor[] {
  return [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: cspContent() },
      injectTo: 'head-prepend',
    },
    { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
  ];
}

/** Adds the policy to built pages only; the dev server needs inline HMR scripts. */
export function securityMetaPlugin(): Plugin {
  return {
    name: 'population-peaks:security-meta',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: () => securityMeta() },
  };
}
