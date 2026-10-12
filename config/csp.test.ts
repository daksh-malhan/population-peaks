import { describe, expect, it } from 'vitest';
import { cspContent, securityMeta } from './csp';

describe('content security policy', () => {
  it('locks every directive the site needs to self or none', () => {
    const csp = cspContent();
    for (const directive of [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it('never allows unsafe-inline, unsafe-eval or wasm-unsafe-eval', () => {
    expect(cspContent()).not.toMatch(/unsafe/);
  });

  it('allows no third-party origins', () => {
    expect(cspContent()).not.toMatch(/https?:|\*/);
  });
});

describe('securityMeta', () => {
  it('puts the CSP meta first in head, followed by a no-referrer policy', () => {
    const tags = securityMeta();
    expect(tags[0]).toMatchObject({
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: cspContent() },
      injectTo: 'head-prepend',
    });
    expect(tags[1]).toMatchObject({
      tag: 'meta',
      attrs: { name: 'referrer', content: 'no-referrer' },
      injectTo: 'head-prepend',
    });
  });
});
