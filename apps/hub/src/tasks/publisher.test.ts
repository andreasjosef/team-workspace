import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitMessage, createLocalPublisher } from './publisher.ts';
import { git, hubHead } from './workspace.ts';

let base: string;
let hubRepo: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hub-publisher-'));
  hubRepo = join(base, 'hub');
  await mkdir(join(hubRepo, 'src'), { recursive: true });
  await writeFile(join(hubRepo, 'src/a.ts'), 'a\n');
  const inHub = [
    `--git-dir=${join(hubRepo, '.git')}`,
    `--work-tree=${hubRepo}`,
  ];
  expect((await git(['init', '-q', '-b', 'main', hubRepo])).code).toBe(0);
  expect((await git([...inHub, 'add', '.'], { cwd: hubRepo })).code).toBe(0);
  expect(
    (await git([...inHub, 'commit', '-q', '-m', 'init'], { cwd: hubRepo })).code
  ).toBe(0);
});
afterEach(() => rm(base, { recursive: true, force: true }));

const patch =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n';

const localPublisher = () =>
  createLocalPublisher({
    hubRepoDir: hubRepo,
    scratchDir: join(base, 'tasks'),
  });

describe('local publisher', () => {
  it('publishes a branch and returns a file:// link, numbering each one', async () => {
    const publisher = localPublisher();
    const baseSha = await hubHead(hubRepo);
    const input = {
      baseSha,
      patch,
      title: 't',
      body: 'b',
      draft: false,
      message: 'fix: a',
    };
    const first = await publisher.publish({ ...input, branch: 'task/one' });
    const second = await publisher.publish({ ...input, branch: 'task/two' });
    expect(first).toEqual({
      success: true,
      value: { url: `file://${hubRepo}#task/one`, number: 1 },
    });
    expect(second.success && second.value.number).toBe(2);
  });

  it('passes on a branch that could not be published as a failure', async () => {
    const publisher = localPublisher();
    const baseSha = await hubHead(hubRepo);
    const out = await publisher.publish({
      baseSha,
      branch: 'task/x',
      patch: patch.replace('-a', '-nope'),
      title: 't',
      body: 'b',
      draft: false,
      message: 'fix: a',
    });
    expect(out.success).toBe(false);
  });
});

describe('commitMessage', () => {
  it('follows the fixed template, with the report id when there is one', () => {
    expect(
      commitMessage({
        title: 'Discount code says invalid',
        incidentId: 'INC-1042',
      })
    ).toBe('fix: Discount code says invalid (INC-1042)');
    expect(commitMessage({ title: 'Signup copy' })).toBe('fix: Signup copy');
  });

  it('keeps the untrusted title to one plain line', () => {
    const msg = commitMessage({
      title: 'Broken\n\nSigned-off-by: someone\u0007 ' + 'x'.repeat(200),
    });
    // eslint-disable-next-line no-control-regex
    expect(msg).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(msg.startsWith('fix: Broken Signed-off-by: someone x')).toBe(true);
    expect(msg.length).toBeLessThanOrEqual('fix: '.length + 72);
  });
});
