import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readRegularFile } from './files.ts';

// Everything here reads files that untrusted code wrote. Rules: never follow
// a symlink (a package could point one at the host's ~/.ssh), never read a
// file bigger than MAX_FILE, never execute anything.

export type InstallScript = {
  pkg: string; // name@version
  hook: 'preinstall' | 'install' | 'postinstall';
  script: string;
  suspicious: boolean;
  reasons: string[];
};

const HOOKS = ['preinstall', 'install', 'postinstall'] as const;
const MAX_FILE = 256_000;

// A heuristic for the demo, not a malware scanner: things an install script
// has no business doing. Tune it on the day.
const SIGNALS: [RegExp, string][] = [
  [/\.npmrc|_authToken|NPM_TOKEN/, 'reads npm credentials'],
  [/GITHUB_TOKEN|GH_TOKEN|AWS_(SECRET|ACCESS)|\.ssh\//, 'reads credentials'],
  [/\bcurl\s|\bwget\s/, 'downloads with curl/wget'],
  [/https?:\/\/(?!registry\.npmjs\.org)[a-z0-9.-]+/i, 'contacts a remote host'],
  [/child_process|\bexecSync\(|\bspawn\(/, 'starts processes'],
  [/\beval\(|new Function\(/, 'evaluates code'],
  [/Buffer\.from\([^)]*base64|atob\(/, 'decodes base64'],
  [
    /JSON\.stringify\(process\.env\)|Object\.(keys|entries)\(process\.env\)/,
    'collects the environment',
  ],
];

const isDir = async (p: string) => {
  const s = await lstat(p).catch(() => null);
  return s?.isDirectory() ?? false;
};

const readSmallFile = async (p: string) =>
  (await readRegularFile(p, MAX_FILE))?.toString('utf8') ?? null;

const scriptFile = (script: string) =>
  /\bnode\s+([\w./-]+\.(?:c|m)?js)\b/.exec(script)?.[1] ?? null;

export const classify = (text: string) =>
  SIGNALS.filter(([re]) => re.test(text)).map(([, reason]) => reason);

const visitPackage = async (dir: string, found: Map<string, InstallScript>) => {
  const raw = await readSmallFile(join(dir, 'package.json'));
  if (raw) {
    let pkg: { name?: unknown; version?: unknown; scripts?: unknown };
    try {
      pkg = JSON.parse(raw);
    } catch {
      pkg = {};
    }
    const id = `${String(pkg.name)}@${String(pkg.version)}`;
    const scripts =
      pkg.scripts && typeof pkg.scripts === 'object'
        ? (pkg.scripts as Record<string, unknown>)
        : {};
    for (const hook of HOOKS) {
      const script = scripts[hook];
      if (typeof script !== 'string' || found.has(`${id}:${hook}`)) continue;
      const file = scriptFile(script);
      // Only a relative path inside the package; never ../ out of it.
      const body =
        file && !file.includes('..') && !file.startsWith('/')
          ? ((await readSmallFile(join(dir, file))) ?? '')
          : '';
      const reasons = classify(`${script}\n${body}`);
      found.set(`${id}:${hook}`, {
        pkg: id,
        hook,
        script,
        suspicious: reasons.length > 0,
        reasons,
      });
    }
  }
  const nested = join(dir, 'node_modules');
  if (await isDir(nested)) await scanNodeModules(nested, found);
};

// Walks npm's nested layout and pnpm's .pnpm store alike.
const scanNodeModules = async (
  nm: string,
  found: Map<string, InstallScript>
): Promise<void> => {
  const entries = await readdir(nm, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue; // symlinks and files are skipped
    const p = join(nm, e.name);
    if (e.name === '.pnpm') {
      for (const s of await readdir(p, { withFileTypes: true })) {
        const inner = join(p, s.name, 'node_modules');
        if (s.isDirectory() && (await isDir(inner))) {
          await scanNodeModules(inner, found);
        }
      }
    } else if (e.name.startsWith('@')) {
      for (const s of await readdir(p, { withFileTypes: true })) {
        if (s.isDirectory()) await visitPackage(join(p, s.name), found);
      }
    } else if (!e.name.startsWith('.')) {
      await visitPackage(p, found);
    }
  }
};

// Every install-time script in a workspace's node_modules. No node_modules
// means nothing to scan; a node_modules that is anything but a real folder
// (a symlink an install script planted, pointing anywhere on the host) is
// refused: callers check for that first, so reaching here with one is a bug.
export const scanInstallScripts = async (
  workdir: string
): Promise<InstallScript[]> => {
  const root = join(workdir, 'node_modules');
  const s = await lstat(root).catch(() => null);
  if (s && !s.isDirectory())
    throw new Error(`Refusing to scan ${root}: not a real directory`);
  const found = new Map<string, InstallScript>();
  await scanNodeModules(root, found);
  return [...found.values()];
};
