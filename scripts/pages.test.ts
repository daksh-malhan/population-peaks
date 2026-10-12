import { describe, expect, it } from 'vitest';
import { escapeHtml, notFoundPage, robots, sitemap, withMeta } from './pages.ts';

const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>population peaks — 3D population maps of any place</title>
    <meta name="description" content="old" />
  </head>
  <body></body>
</html>`;

const meta = {
  title: "Hungary's population distribution",
  description: 'Where 9.6 million people live, as a 3D map.',
  url: 'https://example.org/population-peaks/p/hu/',
  image: 'https://example.org/population-peaks/data/previews/og/HU.jpg',
  imageAlt: "3D map of Hungary's population",
};

describe('withMeta', () => {
  it('sets the title, description, canonical URL and social preview tags', () => {
    const html = withMeta(shell, meta);
    expect(html).toContain("<title>Hungary&#39;s population distribution</title>");
    expect(html).toContain('<meta name="description" content="Where 9.6 million people live, as a 3D map." />');
    expect(html).toContain('<link rel="canonical" href="https://example.org/population-peaks/p/hu/" />');
    expect(html).toContain('<meta property="og:image" content="https://example.org/population-peaks/data/previews/og/HU.jpg" />');
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).not.toContain('content="old"');
  });

  it('is idempotent', () => {
    const once = withMeta(shell, meta);
    expect(withMeta(once, meta)).toBe(once);
  });

  it('escapes names so data can never inject markup', () => {
    const html = withMeta(shell, { ...meta, title: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('site files', () => {
  it('lists every page in the sitemap', () => {
    const xml = sitemap(['https://example.org/population-peaks/', 'https://example.org/population-peaks/p/hu/?a=1&b=2']);
    expect(xml).toContain('<loc>https://example.org/population-peaks/</loc>');
    expect(xml).toContain('<loc>https://example.org/population-peaks/p/hu/?a=1&amp;b=2</loc>');
  });

  it('points robots at the sitemap', () => {
    expect(robots('https://example.org/population-peaks/')).toBe('User-agent: *\nAllow: /\nSitemap: https://example.org/population-peaks/sitemap.xml\n');
  });

  it('builds a 404 page whose only inline style is allowed by hash', () => {
    const html = notFoundPage('https://example.org/population-peaks/');
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(csp).toMatch(/default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain('unsafe');
    expect(html).not.toContain('<script');
    expect(html).toContain('href="https://example.org/population-peaks/"');
  });
});
