import { describe, expect, it } from 'vitest';
import { buildRunArgs, defaultLimits } from './args.ts';
import type { SandboxConfig } from './config.ts';

const config: SandboxConfig = {
  dockerBin: 'docker',
  image: 'sandbox:test',
  network: 'sandbox',
  registryUrl: 'http://verdaccio:4873/',
  proxyUrl: 'http://egress-proxy:8080',
  volumeOptions: 'rw',
  extraArgs: [],
  user: '1000:1000',
};

const spec = (network: 'none' | 'registry') => ({
  name: 'tw-test',
  workdir: '/jobs/1/repo',
  network,
  limits: defaultLimits,
});

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe('buildRunArgs', () => {
  it('applies every cap', () => {
    const args = buildRunArgs(config, spec('none'), ['npm', 'test']);
    expect(flag(args, '--memory')).toBe('1g');
    expect(flag(args, '--memory-swap')).toBe('1g');
    expect(flag(args, '--cpus')).toBe('1');
    expect(flag(args, '--pids-limit')).toBe('256');
    expect(flag(args, '--cap-drop')).toBe('ALL');
    expect(flag(args, '--user')).toBe('1000:1000');
    expect(args).toContain('--read-only');
    expect(args).toContain('no-new-privileges');
    expect(args.slice(-3)).toEqual(['sandbox:test', 'npm', 'test']);
  });

  it('has no network and no proxy settings in the fix phase', () => {
    const args = buildRunArgs(config, spec('none'), ['true']);
    expect(flag(args, '--network')).toBe('none');
    expect(args.join(' ')).not.toMatch(/proxy|registry/i);
  });

  it('routes the install phase through the proxy on the internal network', () => {
    const args = buildRunArgs(config, spec('registry'), ['npm', 'ci']);
    expect(flag(args, '--network')).toBe('sandbox');
    expect(args).toContain('npm_config_registry=http://verdaccio:4873/');
    expect(args).toContain('HTTPS_PROXY=http://egress-proxy:8080');
  });

  it('passes no variable from the hub environment', () => {
    process.env.VULTR_INFERENCE_API_KEY = 'must-not-leak';
    const args = buildRunArgs(config, spec('registry'), ['env']);
    expect(args.join(' ')).not.toContain('must-not-leak');
    expect(args).not.toContain('--env-file');
  });

  it('adds the gVisor runtime only when configured', () => {
    expect(buildRunArgs(config, spec('none'), ['x'])).not.toContain(
      '--runtime'
    );
    const args = buildRunArgs({ ...config, runtime: 'runsc' }, spec('none'), [
      'x',
    ]);
    expect(flag(args, '--runtime')).toBe('runsc');
  });

  it('adds extra mounts with their read-only flag, and still no host variable', () => {
    process.env.VULTR_INFERENCE_API_KEY = 'must-not-leak';
    const args = buildRunArgs(
      { ...config, volumeOptions: 'rw,z' },
      {
        ...spec('none'),
        extraMounts: [
          {
            source: '/var/lib/team-workspace/deps/abc',
            target: '/work/node_modules',
            readonly: true,
          },
          { source: '/srv/scratch', target: '/scratch', readonly: false },
        ],
      },
      ['./node_modules/.bin/vitest', 'run']
    );
    const volumes = args.flatMap((a, i) =>
      args[i - 1] === '--volume' ? [a] : []
    );
    expect(volumes).toEqual([
      '/jobs/1/repo:/work:rw,z',
      '/var/lib/team-workspace/deps/abc:/work/node_modules:ro,z',
      '/srv/scratch:/scratch:rw,z',
    ]);
    expect(args.join(' ')).not.toContain('must-not-leak');
    expect(args).not.toContain('--env-file');
    const env = args.flatMap((a, i) => (args[i - 1] === '--env' ? [a] : []));
    expect(env.map((e) => e.split('=')[0]).sort()).toEqual(
      [
        'CI',
        'HOME',
        'npm_config_audit',
        'npm_config_cache',
        'npm_config_fund',
        'npm_config_update_notifier',
      ].sort()
    );
  });

  it('mounts only /work when no extra mounts are given', () => {
    const args = buildRunArgs(config, spec('none'), ['true']);
    expect(args.filter((a) => a === '--volume')).toHaveLength(1);
  });
});
