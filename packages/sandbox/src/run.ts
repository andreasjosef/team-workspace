import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { BlockedKind } from '@app/shared';
import {
  buildRunArgs,
  defaultLimits,
  SANDBOX_LABEL,
  type ExtraMount,
  type Limits,
  type NetworkMode,
} from './args.ts';
import type { SandboxConfig } from './config.ts';

export type RunOptions = {
  workdir: string;
  network: NetworkMode;
  limits?: Partial<Limits>;
  labels?: Record<string, string>;
  extraMounts?: ExtraMount[];
};

export type SandboxRun = {
  exitCode: number;
  // stdout and stderr interleaved, the tail only (see MAX_OUTPUT).
  output: string;
  durationMs: number;
  // Set when a cap stopped the command rather than the command itself.
  blocked: { kind: Exclude<BlockedKind, 'network'>; detail: string } | null;
};

const MAX_OUTPUT = 200_000;

// Signs that the pids limit, not the program, made the command fail.
const PIDS_EXHAUSTED =
  /fork: (retry: )?Resource temporarily unavailable|spawn EAGAIN|pthread_create failed/i;

const exec = (bin: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (err) => resolve({ code: -1, out: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });

// Runs one command in a fresh container and removes it afterwards. The
// container is kept until it has been inspected, so an OOM kill can be told
// apart from an ordinary failure.
export const runInSandbox = async (
  config: SandboxConfig,
  cmd: string[],
  options: RunOptions
): Promise<SandboxRun> => {
  const limits = { ...defaultLimits, ...options.limits };
  const name = `tw-${randomUUID().slice(0, 12)}`;
  const args = buildRunArgs(
    config,
    {
      name,
      workdir: options.workdir,
      network: options.network,
      limits,
      ...(options.labels ? { labels: options.labels } : {}),
      ...(options.extraMounts ? { extraMounts: options.extraMounts } : {}),
    },
    cmd
  );

  const started = Date.now();
  let output = '';
  let timedOut = false;

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(config.dockerBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      void exec(config.dockerBin, ['kill', name]);
    }, limits.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      output += `\n[sandbox] could not start ${config.dockerBin}: ${err.message}`;
      resolve(-1);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });

  const inspected = await exec(config.dockerBin, [
    'inspect',
    '--format',
    '{{.State.OOMKilled}}',
    name,
  ]);
  await exec(config.dockerBin, ['rm', '--force', name]);

  let blocked: SandboxRun['blocked'] = null;
  if (timedOut) {
    blocked = {
      kind: 'timeout',
      detail: `${cmd.join(' ')} killed after ${limits.timeoutMs} ms`,
    };
  } else if (inspected.out.trim() === 'true') {
    blocked = {
      kind: 'memory',
      detail: `${cmd.join(' ')} killed at the ${limits.memory} memory cap`,
    };
  } else if (exitCode !== 0 && PIDS_EXHAUSTED.test(output)) {
    blocked = {
      kind: 'pids',
      detail: `${cmd.join(' ')} hit the ${limits.pidsLimit}-process cap`,
    };
  }

  return {
    exitCode,
    output: output.slice(-MAX_OUTPUT),
    durationMs: Date.now() - started,
    blocked,
  };
};

// Removes every sandbox container left behind (a crash, a kill -9). The
// hub calls it at start-up.
export const removeLeftoverSandboxes = async (config: SandboxConfig) => {
  const { out } = await exec(config.dockerBin, [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=${SANDBOX_LABEL}`,
  ]);
  const ids = out.split(/\s+/).filter(Boolean);
  if (ids.length) await exec(config.dockerBin, ['rm', '--force', ...ids]);
  return ids.length;
};
