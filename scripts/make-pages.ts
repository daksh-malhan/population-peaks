// Deploy step: per-country share pages with social previews, plus sitemap, robots and 404.
//   node scripts/make-pages.ts <dist> <site-url>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFoundPage, robots, sitemap, withMeta } from './pages.ts';

interface Country {
  id: string;
  name: string;
  preview: boolean;
}

const [dist = 'dist', site = 'https://daksh-malhan.github.io/population-peaks/'] = process.argv.slice(2);
if (!site.endsWith('/')) throw new Error('site URL must end with "/"');

const shell = await readFile(join(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(join(dist, 'data', 'manifest.json'), 'utf8')) as { countries: Country[] };
const possessive = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
const defaultImage = `${site}og-default.jpg`;

await writeFile(
  join(dist, 'index.html'),
  withMeta(shell, {
    title: 'population peaks — 3D population maps of any place',
    description: 'Make 3D population spike maps of any country, state or city and export posters. Data: Kontur Population 2023.',
    url: site,
    image: defaultImage,
    imageAlt: 'A glowing 3D map of where people live',
  }),
);

const urls = [site];
for (const c of manifest.countries) {
  const slug = c.id.toLowerCase();
  const url = `${site}p/${slug}/`;
  const dir = join(dist, 'p', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'index.html'),
    withMeta(shell, {
      title: `${possessive(c.name)} population distribution — population peaks`,
      description: `A 3D map of where people live in ${c.name}. Turn it around, then export a poster.`,
      url,
      image: c.preview ? `${site}data/previews/og/${c.id}.jpg` : defaultImage,
      imageAlt: `3D map of ${possessive(c.name)} population`,
    }),
  );
  urls.push(url);
}

await writeFile(join(dist, 'sitemap.xml'), sitemap(urls));
await writeFile(join(dist, 'robots.txt'), robots(site));
await writeFile(join(dist, '404.html'), notFoundPage(site));
await writeFile(join(dist, '.nojekyll'), '');
console.log(`wrote ${manifest.countries.length} country pages, sitemap.xml, robots.txt and 404.html`);
