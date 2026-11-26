import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadHub, type Hub } from '../hub/load.ts';
import { createHubSync } from './hubSync.ts';
import { git } from './workspace.ts';

// The hub repo following origin's main, against a local bare repo standing
// in for GitHub: `origin` is a bare clone of the hub repo, `dev` a
// developer's clone that pushes to it.

const DEMO_SHOP = fileURLToPath(
  new URL('../../../../demo/shop', import.meta.url)
);
// Local paths are the file protocol, which the hub's git refuses by
// default; these test repos are ours.
const FILE_OK = ['-c', 'protocol.file.allow=always'];
const AS_DEV = ['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid'];

let base: string;
let hub: Hub;
let origin: string;
let dev: string;

const run = async (args: string[], cwd = '/') => {
  const r = await git([...FILE_OK, ...AS_DEV, ...args], { cwd });
  expect(r.code, r.out).toBe(0);
  return r.out.trim();
};
const inRepo = (dir: string) => [
  `--git-dir=${join(dir, '.git')}`,
  `--work-tree=${dir}`,
];

// A commit on origin's main, made by a developer: `files` written, pushed.
const pushToOrigin = async (files: Record<string, string>) => {
  await run([...inRepo(dev), 'pull', '-q', '--ff-only', 'origin', 'main'], dev);
  for (const [path, content] of Object.entries(files))
    await writeFile(join(dev, path), content);
  await run([...inRepo(dev), 'add', '.'], dev);
  await run([...inRepo(dev), 'commit', '-q', '-m', 'dev change'], dev);
  await run([...inRepo(dev), 'push', '-q', 'origin', 'main'], dev);
  return run([...inRepo(dev), 'rev-parse', 'HEAD'], dev);
};

const hubHeadSha = () =>
  run([`--git-dir=${join(hub.repoDir, '.git')}`, 'rev-parse', 'HEAD']);

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hub-sync-'));
  const repoDir = join(base, 'hub');
  await cp(DEMO_SHOP, repoDir, {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  });
  await run(['init', '-q', '-b', 'main', repoDir]);
  await run([...inRepo(repoDir), 'add', '.'], repoDir);
  await run([...inRepo(repoDir), 'commit', '-q', '-m', 'start'], repoDir);
  origin = join(base, 'origin.git');
  dev = join(base, 'dev');
  await run(['clone', '-q', '--bare', '--', repoDir, origin]);
  await run(['clone', '-q', '--', origin, dev]);
  await run(
    [`--git-dir=${join(repoDir, '.git')}`, 'remote', 'add', 'origin', origin],
    repoDir
  );
  hub = await loadHub(repoDir);
});
afterEach(() => rm(base, { recursive: true, force: true }));

const noClone = async () => {};

describe('hub sync', () => {
  it('fetches origin main, resets the checkout to it and reloads the hub', async () => {
    const sha = await pushToOrigin({
      'decisions/D-020-new.md':
        '---\nid: D-020\ntitle: Fresh decision\ndate: 2026-11-26\nby: dev\nfiles: []\n---\nNew.\n',
      '.hub/prompts/cs.md': 'The prompt a developer merged.\n',
    });
    const logs: string[] = [];
    const cloned: string[] = [];

    const out = await createHubSync(hub).sync({
      log: (m) => logs.push(m),
      clone: async (baseSha) => {
        cloned.push(baseSha);
      },
    });

    expect(out).toEqual({ baseSha: sha, fetched: true });
    expect(cloned).toEqual([sha]);
    expect(await hubHeadSha()).toBe(sha);
    expect(
      await readFile(join(hub.repoDir, 'decisions/D-020-new.md'), 'utf8')
    ).toContain('Fresh decision');
    expect(hub.docs.map((d) => d.id)).toContain('D-020');
    expect(hub.roles.get('cs')!.prompt).toBe(
      'The prompt a developer merged.\n'
    );
    expect(logs).toEqual([]);
  });

  it('carries on from the last good main when the fetch fails, and says so', async () => {
    const before = await hubHeadSha();
    await rm(origin, { recursive: true, force: true });
    const logs: string[] = [];

    const out = await createHubSync(hub).sync({
      log: (m) => logs.push(m),
      clone: noClone,
    });

    expect(out).toEqual({ baseSha: before, fetched: false });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(
      /^Fetching origin main failed; starting from the last good main \([0-9a-f]{12}\)/
    );
  });

  it('starts from the checkout as it is when there is no origin', async () => {
    await run(
      [`--git-dir=${join(hub.repoDir, '.git')}`, 'remote', 'remove', 'origin'],
      hub.repoDir
    );
    const before = await hubHeadSha();
    const logs: string[] = [];

    const out = await createHubSync(hub).sync({
      log: (m) => logs.push(m),
      clone: noClone,
    });

    expect(out).toEqual({ baseSha: before, fetched: false });
    expect(logs).toEqual([]);
  });

  it('keeps the last good main when the new one does not load, and says so', async () => {
    const before = await hubHeadSha();
    const promptBefore = hub.roles.get('cs')!.prompt;
    await pushToOrigin({ '.hub/roles/cs.json': '{ not json' });
    const logs: string[] = [];

    const out = await createHubSync(hub).sync({
      log: (m) => logs.push(m),
      clone: noClone,
    });

    expect(out).toEqual({ baseSha: before, fetched: true });
    expect(await hubHeadSha()).toBe(before);
    expect(
      await readFile(join(hub.repoDir, '.hub/roles/cs.json'), 'utf8')
    ).toContain('"name": "cs"');
    expect(hub.roles.get('cs')!.prompt).toBe(promptBefore);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^origin main [0-9a-f]{12} does not load/);
  });

  it('holds one lock over fetch, reset, reload and clone: a second sync waits for the first clone', async () => {
    const first = await pushToOrigin({ 'notes.txt': 'one\n' });
    const sync = createHubSync(hub);
    let releaseClone!: () => void;
    let cloneStarted!: () => void;
    const started = new Promise<void>((r) => (cloneStarted = r));
    const firstSync = sync.sync({
      log: () => {},
      clone: () => {
        cloneStarted();
        return new Promise<void>((r) => (releaseClone = r));
      },
    });
    await started;

    // A developer merges while the first task is still cloning, and a
    // second task starts.
    const second = await pushToOrigin({ 'notes.txt': 'two\n' });
    const secondClones: string[] = [];
    const secondSync = sync.sync({
      log: () => {},
      clone: async (sha) => {
        secondClones.push(sha);
      },
    });
    // Give the second sync every chance to run: it must not touch the
    // checkout while the first clone reads it.
    await new Promise((r) => setTimeout(r, 200));
    expect(secondClones).toEqual([]);
    expect(await hubHeadSha()).toBe(first);

    releaseClone();
    expect((await firstSync).baseSha).toBe(first);
    expect((await secondSync).baseSha).toBe(second);
    expect(secondClones).toEqual([second]);
  });

  it('releases the lock when a clone fails', async () => {
    const sync = createHubSync(hub);
    await expect(
      sync.sync({
        log: () => {},
        clone: async () => {
          throw new Error('clone broke');
        },
      })
    ).rejects.toThrow('clone broke');
    const out = await sync.sync({ log: () => {}, clone: noClone });
    expect(out.fetched).toBe(true);
  });
});
