import type { HtmlTagDescriptor, Plugin } from 'vite';

/** Preload the Latin Sora file so the title paints once, in its real font (better LCP). */
export function fontPreloadTags(files: string[], base: string): HtmlTagDescriptor[] {
  const font = files.find((f) => /sora-latin-wght-normal-[\w-]+\.woff2$/.test(f));
  if (!font) return [];
  return [{ tag: 'link', attrs: { rel: 'preload', href: `${base}${font}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' }];
}

export function fontPreloadPlugin(base: string): Plugin {
  return {
    name: 'population-peaks:font-preload',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: (_html, ctx) => fontPreloadTags(Object.keys(ctx.bundle ?? {}), base) },
  };
}
