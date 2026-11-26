import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  branchFromHub,
  createWorkspace,
  diffPaths,
  git,
  hubHead,
  publishBranch,
  trackedFiles,
} from './workspace.ts';

// The real runner's git plumbing against a throwaway hub repo: branch, edit,
// diff only what the agent touched, publish it on a branch of its own.

let base: string;
let hubRepo: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hub-git-'));
  hubRepo = join(base, 'hub');
  await mkdir(join(hubRepo, 'src'), { recursive: true });
  await mkdir(join(hubRepo, '.hub'));
  await writeFile(
    join(hubRepo, 'src/discount.ts'),
    'const c = CODES[input];\n'
  );
  await writeFile(join(hubRepo, '.hub/cs.json'), '{"allow":["src/**"]}\n');
  const inHub = [
    `--git-dir=${join(hubRepo, '.git')}`,
    `--work-tree=${hubRepo}`,
  ];
  expect((await git(['init', '-q', '-b', 'main', hubRepo])).code).toBe(0);
  expect((await git([...inHub, 'add', '.'])).code).toBe(0);
  expect((await git([...inHub, 'commit', '-q', '-m', 'init'])).code).toBe(0);
});
afterEach(() => rm(base, { recursive: true, force: true }));

const inHub = () => [`--git-dir=${join(hubRepo, '.git')}`];
const show = async (args: string[]) =>
  (await git([...inHub(), ...args])).out.trim();

describe('task workspace', () => {
  it('branches, diffs only touched paths, and publishes them on a branch, main untouched', async () => {
    const baseSha = await hubHead(hubRepo);
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/);
    const ws = await createWorkspace(join(base, 'tasks'), 't1');
    await branchFromHub(ws, hubRepo);
    expect(await trackedFiles(ws)).toEqual(['.hub/cs.json', 'src/discount.ts']);
    // The .git pointer is gone: nothing in /work leads to the git dir.
    await expect(readFile(join(ws.repo, '.git'), 'utf8')).rejects.toThrow();

    // The agent's edits...
    await writeFile(
      join(ws.repo, 'src/discount.ts'),
      'const c = CODES[input.toUpperCase()];\n'
    );
    await writeFile(join(ws.repo, 'src/case.test.ts'), 'it("works")\n');
    // ...and something a test run wrote, which the agent never proposed.
    await writeFile(join(ws.repo, '.hub/cs.json'), '{"allow":["**"]}\n');

    const diff = await diffPaths(ws, ['src/discount.ts', 'src/case.test.ts']);
    expect(diff).toContain('+const c = CODES[input.toUpperCase()];');
    expect(diff).toContain('new file mode 100644');
    expect(diff).not.toContain('.hub');

    const published = await publishBranch(hubRepo, join(base, 'tasks'), {
      baseSha,
      branch: 'task/t1',
      patch: diff,
      message: 'fix: Discount case (INC-1)',
    });
    expect(published).toEqual({ success: true, value: null });

    // The branch holds the patch, on top of the base, as the hub.
    expect(await show(['log', '--format=%s|%an|%P', '-1', 'task/t1'])).toBe(
      `fix: Discount case (INC-1)|Team hub|${baseSha}`
    );
    expect(
      (await show(['diff', '--name-only', baseSha, 'task/t1'])).split('\n')
    ).toEqual(['src/case.test.ts', 'src/discount.ts']);
    expect(await show(['show', 'task/t1:src/discount.ts'])).toContain(
      'toUpperCase'
    );
    // main, the hub's checkout and its index are untouched.
    expect(await show(['rev-parse', 'main'])).toBe(baseSha);
    expect(await readFile(join(hubRepo, 'src/discount.ts'), 'utf8')).toBe(
      'const c = CODES[input];\n'
    );
    expect(
      (
        await git(
          [...inHub(), `--work-tree=${hubRepo}`, 'status', '--porcelain'],
          {
            cwd: hubRepo,
          }
        )
      ).out
    ).toBe('');
    // The worktree is gone again.
    expect(await show(['worktree', 'list', '--porcelain'])).not.toContain(
      join(base, 'tasks')
    );
    expect(await readdir(join(base, 'tasks'))).toEqual(['t1']);
  });

  it("refuses a patch that doesn't apply, and leaves no branch behind", async () => {
    const bad =
      'diff --git a/src/discount.ts b/src/discount.ts\n--- a/src/discount.ts\n+++ b/src/discount.ts\n@@ -1 +1 @@\n-not there\n+x\n';
    const published = await publishBranch(hubRepo, join(base, 'tasks'), {
      baseSha: await hubHead(hubRepo),
      branch: 'task/t2',
      patch: bad,
      message: 'x',
    });
    expect(published.success).toBe(false);
    expect(!published.success && published.message).toMatch(/git apply failed/);
    expect(await show(['branch', '--list', 'task/*'])).toBe('');
    expect(await show(['worktree', 'list', '--porcelain'])).not.toContain(
      join(base, 'tasks')
    );
  });

  it('refuses to publish onto a branch that already exists', async () => {
    const baseSha = await hubHead(hubRepo);
    expect((await git([...inHub(), 'branch', 'task/t3', baseSha])).code).toBe(
      0
    );
    const published = await publishBranch(hubRepo, join(base, 'tasks'), {
      baseSha,
      branch: 'task/t3',
      patch: '',
      message: 'x',
    });
    expect(published.success).toBe(false);
    // The branch that was there stays as it was.
    expect(await show(['rev-parse', 'task/t3'])).toBe(baseSha);
  });
});
