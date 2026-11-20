import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyToHub,
  branchFromHub,
  createWorkspace,
  diffPaths,
  git,
  trackedFiles,
} from './workspace.ts';

// The real runner's git plumbing against a throwaway hub repo: branch, edit,
// diff only what the agent touched, apply to main.

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

describe('task workspace', () => {
  it('branches, diffs only touched paths, and applies to main', async () => {
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

    expect(await applyToHub(hubRepo, diff, 'Fix discount case')).toBeNull();
    expect(await readFile(join(hubRepo, 'src/discount.ts'), 'utf8')).toContain(
      'toUpperCase'
    );
    expect(await readFile(join(hubRepo, '.hub/cs.json'), 'utf8')).toContain(
      'src/**'
    );
    const log = await git([
      `--git-dir=${join(hubRepo, '.git')}`,
      'log',
      '--format=%s',
      '-1',
    ]);
    expect(log.out.trim()).toBe('Fix discount case');
  });

  it("refuses a patch that doesn't apply", async () => {
    const bad =
      'diff --git a/src/discount.ts b/src/discount.ts\n--- a/src/discount.ts\n+++ b/src/discount.ts\n@@ -1 +1 @@\n-not there\n+x\n';
    expect(await applyToHub(hubRepo, bad, 'x')).toMatch(/git apply failed/);
  });
});
