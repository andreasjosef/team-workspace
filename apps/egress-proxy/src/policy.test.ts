import { describe, expect, it } from 'vitest';
import { decideConnect, decideHttp, parseAllowlist } from './policy.ts';

const allow = parseAllowlist('verdaccio:4873');

describe('egress policy', () => {
  it('lets registry reads through', () => {
    expect(decideHttp('GET', 'http://verdaccio:4873/zod', allow).allow).toBe(
      true
    );
    expect(decideHttp('HEAD', 'http://VERDACCIO:4873/zod', allow).allow).toBe(
      true
    );
  });

  it.each([
    ['GET', 'http://collector.attacker.example/steal'],
    ['POST', 'http://collector.attacker.example/steal'],
    ['PUT', 'http://verdaccio:4873/tiny-util'], // no publishing from a sandbox
    ['GET', 'http://verdaccio:80/zod'],
    ['GET', 'https://verdaccio:4873/zod'],
    ['GET', '/relative'],
  ])('refuses %s %s', (method, url) => {
    expect(decideHttp(method, url, allow).allow).toBe(false);
  });

  it('refuses every tunnel', () => {
    expect(decideConnect().allow).toBe(false);
  });
});
