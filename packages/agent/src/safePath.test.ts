import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveInside } from './safePath.ts';

let base: string;
let root: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'safe-path-'));
  root = join(base, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
});
afterEach(() => rm(base, { recursive: true, force: true }));

describe('resolveInside', () => {
  it('resolves a plain file inside the root', async () => {
    await writeFile(join(root, 'src', 'a.ts'), 'a');
    expect(await resolveInside(root, 'src/a.ts')).toMatchObject({
      success: true,
    });
  });

  // The host deletes and reads files through it, so a test run that swaps a
  // parent folder for a symlink must not redirect either.
  it('refuses a path whose parent folder is a symlink', async () => {
    const outside = join(base, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'a.test.ts'), 'x');
    await symlink(outside, join(root, 'src', 'cases'));
    expect(await resolveInside(root, 'src/cases/a.test.ts')).toMatchObject({
      success: false,
      code: 'invalid',
    });
  });

  it('refuses a path that is itself a symlink', async () => {
    await writeFile(join(base, 'secret'), 'x');
    await symlink(join(base, 'secret'), join(root, 'src', 'a.ts'));
    expect(await resolveInside(root, 'src/a.ts')).toMatchObject({
      success: false,
      code: 'invalid',
    });
  });
});
