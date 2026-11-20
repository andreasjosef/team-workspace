import type { RolePolicy } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { checkPolicy, globToRegExp, refusalFor } from './policy.ts';

const cs: RolePolicy = {
  name: 'cs',
  label: 'Customer support',
  description: '',
  systemPrompt: 'prompts/cs.md',
  canCreate: ['bug'],
  write: {
    allow: ['src/**', 'decisions/**'],
    deny: ['src/auth/**', 'src/billing/**', 'infra/**', 'package.json'],
  },
  maxChangedLines: 50,
  approval: 'dev',
};

const dev: RolePolicy = {
  ...cs,
  name: 'dev',
  write: { allow: ['**'], deny: [] },
  approval: null,
};

describe('globToRegExp', () => {
  it.each([
    ['src/**', 'src/checkout/discount.ts', true],
    ['src/**', 'src', true],
    ['src/**', 'srcx/a.ts', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/checkout/a.ts', false],
    ['**/*.test.ts', 'src/a/b.test.ts', true],
    ['**/*.test.ts', 'b.test.ts', true],
    ['package.json', 'package.json', true],
    ['package.json', 'packageXjson', false],
    ['**', 'anything/at/all', true],
  ])('%s vs %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe('refusalFor', () => {
  it('allows paths inside the scope', () => {
    expect(refusalFor(cs, 'src/checkout/discount.ts')).toBeNull();
    expect(refusalFor(cs, './decisions/D-020.md')).toBeNull();
  });

  it('lets deny win over allow', () => {
    expect(refusalFor(cs, 'src/auth/users.ts')).toBe('deny src/auth/**');
  });

  it('refuses paths outside allow', () => {
    expect(refusalFor(cs, 'README.md')).toMatch(/^outside allow/);
  });

  it('never lets any role write role policies', () => {
    expect(refusalFor(dev, '.hub/roles/cs.json')).toMatch(
      /never agent-writable/
    );
    expect(refusalFor(dev, '.hub')).toMatch(/never agent-writable/);
  });
});

describe('checkPolicy', () => {
  it('refuses the whole proposal and reports every refused path', () => {
    const r = checkPolicy(cs, [
      { path: 'src/checkout/discount.ts', search: 'a', replace: 'b' },
      { path: 'src/auth/users.ts', search: 'a', replace: 'b' },
      { path: '.hub/roles/cs.json', create: '{}' },
    ]);
    expect(r).toEqual({
      ok: false,
      refusals: [
        { path: 'src/auth/users.ts', rule: 'deny src/auth/**' },
        {
          path: '.hub/roles/cs.json',
          rule: 'role policies are never agent-writable',
        },
      ],
    });
  });

  it('enforces the role size cap', () => {
    const big = Array.from({ length: 60 }, () => 'x').join('\n');
    const r = checkPolicy(cs, [{ path: 'src/a.ts', create: big }]);
    expect(r.ok).toBe(false);
  });

  it('passes an in-scope proposal', () => {
    expect(
      checkPolicy(cs, [{ path: 'src/checkout/a.test.ts', create: 'it()' }])
    ).toEqual({
      ok: true,
    });
  });
});
