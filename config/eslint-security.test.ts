import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/__probe__.ts' });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

describe('security lint rules', () => {
  it.each([
    ['innerHTML', 'document.body.innerHTML = location.hash;'],
    ['outerHTML', 'document.body.outerHTML = location.hash;'],
    ['insertAdjacentHTML', "document.body.insertAdjacentHTML('beforeend', location.hash);"],
    ['document.write', 'document.write(location.hash);'],
  ])('rejects %s', async (_name, code) => {
    expect(await ruleIds(code)).toContain('no-restricted-properties');
  });

  it('rejects eval and the Function constructor', async () => {
    expect(await ruleIds('eval(location.hash);')).toContain('no-eval');
    expect(await ruleIds('new Function(location.hash);')).toContain('no-new-func');
  });

  it('accepts textContent', async () => {
    expect(await ruleIds('document.body.textContent = location.hash;')).toEqual([]);
  });
});
