import { describe, expect, it } from 'vitest';
import { fontPreloadTags } from './fontPreload';

describe('font preload', () => {
  it('preloads the Latin Sora font file the build emitted', () => {
    const tags = fontPreloadTags(['assets/index-abc.js', 'assets/sora-latin-ext-wght-normal-x1.woff2', 'assets/sora-latin-wght-normal-Dd1.woff2'], '/population-peaks/');
    expect(tags).toEqual([
      {
        tag: 'link',
        attrs: { rel: 'preload', href: '/population-peaks/assets/sora-latin-wght-normal-Dd1.woff2', as: 'font', type: 'font/woff2', crossorigin: '' },
        injectTo: 'head',
      },
    ]);
  });

  it('adds nothing when the font is missing', () => {
    expect(fontPreloadTags(['assets/index.js'], '/')).toEqual([]);
  });
});
