import { fail, ok, type Result } from '@app/shared';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// The workspace was written by untrusted code, and the paths come from an
// LLM. Resolve a relative path to an existing file inside root, and refuse
// anything that leaves it: `..`, absolute paths, and symlinks (a test run can
// plant src/x -> /home/hub/.ssh, and we'd send it to the LLM).
export const resolveInside = async (
  root: string,
  rel: string
): Promise<Result<string>> => {
  if (!rel || isAbsolute(rel) || rel.includes('\0')) {
    return fail('invalid', `Not a relative path: ${rel}`);
  }
  const rootReal = await realpath(root);
  const target = resolve(rootReal, rel);
  if (!target.startsWith(rootReal + sep)) {
    return fail('invalid', `Outside the workspace: ${rel}`);
  }
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    return fail('not_found', `No such file: ${rel}`);
  }
  // realpath differs from the plain resolution only if a symlink is involved.
  if (real !== target) return fail('invalid', `Symlinked path refused: ${rel}`);
  return ok(target);
};

// The same rules for a file that doesn't exist yet: it must not exist, and
// its nearest existing parent directory must resolve without a symlink.
export const resolveNewInside = async (
  root: string,
  rel: string
): Promise<Result<string>> => {
  if (!rel || isAbsolute(rel) || rel.includes('\0')) {
    return fail('invalid', `Not a relative path: ${rel}`);
  }
  const rootReal = await realpath(root);
  const target = resolve(rootReal, rel);
  if (!target.startsWith(rootReal + sep)) {
    return fail('invalid', `Outside the workspace: ${rel}`);
  }
  if (await lstat(target).catch(() => null)) {
    return fail('invalid', `Already exists, edit it instead: ${rel}`);
  }
  let parent = dirname(target);
  while (!(await lstat(parent).catch(() => null))) parent = dirname(parent);
  if ((await realpath(parent)) !== parent) {
    return fail('invalid', `Symlinked path refused: ${rel}`);
  }
  return ok(target);
};

export const toRelative = (root: string, abs: string) =>
  relative(root, abs).split(sep).join('/');
