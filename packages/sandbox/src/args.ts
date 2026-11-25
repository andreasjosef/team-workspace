import type { SandboxConfig } from './config.ts';

// `none`: no network at all (typecheck, tests, the fix loop).
// `registry`: the internal network, where the only reachable host is the
// egress proxy, which only forwards reads from the local registry.
export type NetworkMode = 'none' | 'registry';

export type Limits = {
  memory: string;
  cpus: number;
  pidsLimit: number;
  timeoutMs: number;
  // Size of the writable /tmp (which is also $HOME).
  tmpSize: string;
};

export const defaultLimits: Limits = {
  memory: '1g',
  cpus: 1,
  pidsLimit: 256,
  timeoutMs: 120_000,
  tmpSize: '512m',
};

// A host directory bind-mounted into the sandbox besides /work, e.g. the
// warm dependency cache at /work/node_modules (read-only).
export type ExtraMount = {
  source: string;
  target: string;
  readonly: boolean;
};

export type RunSpec = {
  name: string;
  // Host directory mounted at /work: the only thing the sandbox can change.
  workdir: string;
  network: NetworkMode;
  limits: Limits;
  // Labels let the hub find and remove leftovers after a crash.
  labels?: Record<string, string>;
  extraMounts?: ExtraMount[];
};

export const SANDBOX_LABEL = 'team-workspace.sandbox';

// Where the task's worktree appears inside every sandbox.
export const CONTAINER_WORKDIR = '/work';

// Options for an extra mount: the configured bind options with the access
// mode swapped and any SELinux label made shared. /work keeps `Z` (a label
// private to one container), but an extra mount such as a dependency cache
// entry is used by several sandboxes at once, so `rw,Z` becomes `ro,z`.
const sharedMountOptions = (volumeOptions: string, readonly: boolean) =>
  [
    readonly ? 'ro' : 'rw',
    ...volumeOptions
      .split(',')
      .filter((o) => o && o !== 'rw' && o !== 'ro')
      .map((o) => (o === 'Z' ? 'z' : o)),
  ]
    .filter((o, i, all) => all.indexOf(o) === i)
    .join(',');

// The whole containment policy, as a pure function: easy to read, easy to
// test, and the one place to change it. No secrets go in here, ever: the
// environment is built from scratch, never copied from the hub.
export const buildRunArgs = (
  config: SandboxConfig,
  spec: RunSpec,
  cmd: string[]
): string[] => {
  const { limits } = spec;
  const env: Record<string, string> = {
    HOME: '/tmp/home',
    CI: 'true',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_cache: '/tmp/home/.npm',
  };
  if (spec.network === 'registry') {
    Object.assign(env, {
      npm_config_registry: config.registryUrl,
      // Lockfiles name the registry they were made against; fetch every
      // tarball from ours instead (the proxy would refuse any other host).
      npm_config_replace_registry_host: 'always',
      npm_config_proxy: config.proxyUrl,
      npm_config_https_proxy: config.proxyUrl,
      HTTP_PROXY: config.proxyUrl,
      HTTPS_PROXY: config.proxyUrl,
      http_proxy: config.proxyUrl,
      https_proxy: config.proxyUrl,
      // Node's own fetch/http honour the proxy variables only with this set.
      // Code that ignores the proxy still can't get out (internal network);
      // it just doesn't show up in the denied log.
      NODE_USE_ENV_PROXY: '1',
    });
  }

  const args = [
    'run',
    '--name',
    spec.name,
    '--init',
    '--user',
    config.user,
    '--read-only',
    '--tmpfs',
    `/tmp:rw,exec,nosuid,size=${limits.tmpSize}`,
    '--volume',
    `${spec.workdir}:${CONTAINER_WORKDIR}:${config.volumeOptions}`,
    ...(spec.extraMounts ?? []).flatMap((m) => [
      '--volume',
      `${m.source}:${m.target}:${sharedMountOptions(config.volumeOptions, m.readonly)}`,
    ]),
    '--workdir',
    CONTAINER_WORKDIR,
    '--memory',
    limits.memory,
    '--memory-swap',
    limits.memory,
    '--cpus',
    String(limits.cpus),
    '--pids-limit',
    String(limits.pidsLimit),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--network',
    spec.network === 'none' ? 'none' : config.network,
    '--label',
    `${SANDBOX_LABEL}=1`,
  ];
  for (const [k, v] of Object.entries(spec.labels ?? {})) {
    args.push('--label', `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(env)) {
    args.push('--env', `${k}=${v}`);
  }
  if (config.runtime) args.push('--runtime', config.runtime);
  args.push(...config.extraArgs, config.image, ...cmd);
  return args;
};
