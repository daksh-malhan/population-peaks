import { createHash } from 'node:crypto';

export interface PageMeta {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MANAGED = [
  /\s*<meta name="description"[^>]*>/g,
  /\s*<meta property="og:[^"]*"[^>]*>/g,
  /\s*<meta name="twitter:[^"]*"[^>]*>/g,
  /\s*<link rel="canonical"[^>]*>/g,
];

/** Give a copy of the app shell its own title, description, canonical URL and social preview. */
export function withMeta(html: string, meta: PageMeta): string {
  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
  for (const re of MANAGED) out = out.replace(re, '');
  const tags = [
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="population peaks" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  return out.replace(/\s*<\/head>/, `\n    ${tags.join('\n    ')}\n  </head>`);
}

export function sitemap(urls: string[]): string {
  const body = urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function robots(siteUrl: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`;
}

/** GitHub Pages serves this for unknown paths. No scripts; its one inline style is allowed by hash. */
export function notFoundPage(siteUrl: string): string {
  const style =
    'body{margin:0;min-height:100vh;display:grid;place-content:center;gap:12px;background:#0f1013;color:#f3f1f4;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}a{color:#ff8a9b}h1{font-size:22px;margin:0}';
  const hash = createHash('sha256').update(style).digest('base64');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Page not found — population peaks</title>
    <style>${style}</style>
  </head>
  <body>
    <h1>There's no map at this address.</h1>
    <p><a href="${escapeHtml(siteUrl)}">Open population peaks</a> and search for a place.</p>
  </body>
</html>
`;
}
