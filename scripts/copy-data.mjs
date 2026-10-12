// Copy a data release (or the test fixture) into the built site: node scripts/copy-data.mjs <from> <to>
import { cp, rm } from 'node:fs/promises';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: node scripts/copy-data.mjs <from> <to>');
  process.exit(2);
}
await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
