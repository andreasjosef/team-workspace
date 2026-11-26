import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.ts';

const REAL = {
  RUNNER: 'real',
  VULTR_INFERENCE_API_KEY: 'key',
  INFERENCE_MODEL: 'model',
};

describe('env', () => {
  it('leaves GitHub off by default: no repo means the local publisher', () => {
    const env = loadEnv({});
    expect(env.GITHUB_REPO).toBeUndefined();
    expect(env.GITHUB_API_URL).toBe('https://api.github.com');
  });

  it('treats an empty GITHUB_REPO as unset', () => {
    expect(loadEnv({ ...REAL, GITHUB_REPO: '' }).GITHUB_REPO).toBeUndefined();
  });

  it('needs GITHUB_TOKEN when GITHUB_REPO is set and the runner is real', () => {
    expect(() => loadEnv({ ...REAL, GITHUB_REPO: 'demo/shop' })).toThrow(
      /GITHUB_TOKEN/
    );
    expect(() =>
      loadEnv({ ...REAL, GITHUB_REPO: 'demo/shop', GITHUB_TOKEN: '' })
    ).toThrow(/GITHUB_TOKEN/);
    const env = loadEnv({
      ...REAL,
      GITHUB_REPO: 'demo/shop',
      GITHUB_TOKEN: 'token',
    });
    expect(env.GITHUB_REPO).toBe('demo/shop');
  });

  it('does not need a token for the mock runner', () => {
    expect(loadEnv({ GITHUB_REPO: 'demo/shop' }).GITHUB_REPO).toBe('demo/shop');
  });

  it('takes GITHUB_REPO only as owner/name', () => {
    for (const repo of [
      'shop',
      'https://github.com/demo/shop',
      'demo/shop/extra',
      'demo/..',
      'de mo/shop',
    ])
      expect(() =>
        loadEnv({ ...REAL, GITHUB_REPO: repo, GITHUB_TOKEN: 'token' })
      ).toThrow();
  });
});
