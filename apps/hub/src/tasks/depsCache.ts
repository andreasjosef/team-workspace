import { readRegularFile } from '@app/sandbox';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

// The warm dependency cache: one node_modules per lockfile, under
// DEPS_CACHE_DIR/<sha256 of package-lock.json>. A task with a known lockfile
// mounts its entry read-only at /work/node_modules instead of installing.
//
// An entry only ever appears through one atomic rename, after its install
// passed the same vetting as any other (exit code, the proxy's denied log,
// the install-script scanner). On the host this file hashes, renames and
// deletes folders and copies two manifest files; it never runs anything from
// a worktree or the cache.

export type Lockfile = {
  // SHA-256 of package-lock.json, hex.
  key: string;
  packageJson: Buffer;
  lock: Buffer;
};

const SCRATCH_PREFIX = '.scratch-';

// The worktree's manifest and lockfile, or null when it has no lockfile (the
// task then installs as before, uncached). Regular files only: a symlinked
// manifest doesn't count.
export const readLockfile = async (repo: string): Promise<Lockfile | null> => {
  const lock = await readRegularFile(join(repo, 'package-lock.json'));
  const packageJson = await readRegularFile(join(repo, 'package.json'));
  if (!lock || !packageJson) return null;
  const key = createHash('sha256').update(lock).digest('hex');
  return { key, packageJson, lock };
};

// The entry for this lockfile, if one was ever completed.
export const findEntry = async (cacheDir: string, key: string) => {
  const path = join(cacheDir, key);
  const s = await lstat(path).catch(() => null);
  return s?.isDirectory() ? path : null;
};

// A fresh folder beside the entries (same filesystem, so the rename into
// place is atomic) holding exactly the bytes that were hashed.
export const createScratch = async (cacheDir: string, lock: Lockfile) => {
  await mkdir(cacheDir, { recursive: true });
  const dir = await mkdtemp(
    join(cacheDir, `${SCRATCH_PREFIX}${lock.key.slice(0, 12)}-`)
  );
  await writeFile(join(dir, 'package.json'), lock.packageJson);
  await writeFile(join(dir, 'package-lock.json'), lock.lock);
  return dir;
};

// Moves a vetted install into the cache in one rename. If another task got
// there first, the rename fails on the non-empty target and theirs is used:
// both were installed from the same lockfile and both passed the same checks.
export const promoteScratch = async (
  cacheDir: string,
  key: string,
  scratch: string
): Promise<string> => {
  const entry = join(cacheDir, key);
  try {
    await rename(join(scratch, 'node_modules'), entry);
    return entry;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const existing =
      code === 'ENOTEMPTY' || code === 'EEXIST'
        ? await findEntry(cacheDir, key)
        : null;
    if (existing) return existing;
    throw err;
  }
};

export const removeScratch = (scratch: string) =>
  rm(scratch, { recursive: true, force: true });

// Scratch folders a crash left behind. The hub calls it at start-up, before
// any task runs.
export const removeLeftoverScratch = async (cacheDir: string) => {
  const names = await readdir(cacheDir).catch(() => []);
  const leftovers = names.filter((n) => n.startsWith(SCRATCH_PREFIX));
  for (const name of leftovers) await removeScratch(join(cacheDir, name));
  return leftovers.length;
};

// The mount point for the cache entry: whatever the worktree had at
// node_modules (a committed folder, a symlink) is deleted, without following
// links, and an empty folder takes its place.
export const prepareMountPoint = async (repo: string) => {
  const path = join(repo, 'node_modules');
  await rm(path, { recursive: true, force: true });
  await mkdir(path);
};
