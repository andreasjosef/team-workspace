import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEdits, checkGuardrails, parseEditsResponse } from './edits.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'edits-'));
  await mkdir(join(root, 'src/checkout'), { recursive: true });
  await writeFile(
    join(root, 'src/checkout/discount.ts'),
    'export const find = (code: string) => CODES[code];\n'
  );
  await writeFile(
    join(root, 'src/checkout/discount.test.ts'),
    'it("works", () => {});\n'
  );
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('parseEditsResponse', () => {
  it('finds the JSON inside a fenced reply, both edit kinds', () => {
    const r = parseEditsResponse(
      'Sure!\n```json\n{"edits":[{"path":"a.ts","search":"x","replace":"y"},{"path":"b.test.ts","create":"it()"}]}\n```'
    );
    expect(r.success).toBe(true);
  });

  it('rejects a reply without edits', () => {
    expect(parseEditsResponse('{"edits": []}').success).toBe(false);
    expect(parseEditsResponse('I could not fix it').success).toBe(false);
  });
});

describe('checkGuardrails', () => {
  it.each(['src/user.test.ts', 'test/user.ts', 'src/__tests__/a.ts'])(
    'refuses changing the existing test %s',
    (path) => {
      expect(
        checkGuardrails([{ path, search: 'a', replace: 'b' }]).success
      ).toBe(false);
    }
  );

  it('allows adding a new test', () => {
    expect(
      checkGuardrails([{ path: 'src/a.test.ts', create: 'it()' }]).success
    ).toBe(true);
  });

  it.each(['node_modules/zod/index.js', 'pnpm-lock.yaml', '.git/config'])(
    'refuses %s, even as a new file',
    (path) => {
      expect(checkGuardrails([{ path, create: 'x' }]).success).toBe(false);
    }
  );

  it('refuses wholesale deletion', () => {
    const search = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    expect(
      checkGuardrails([{ path: 'src/a.ts', search, replace: '' }]).success
    ).toBe(false);
  });
});

describe('applyEdits', () => {
  it('applies a fix and adds a reproduction test', async () => {
    const r = await applyEdits(root, [
      {
        path: 'src/checkout/discount.ts',
        search: 'CODES[code]',
        replace: 'CODES[code.toUpperCase()]',
      },
      {
        path: 'src/checkout/case.test.ts',
        create: 'it("is case-insensitive", () => {});\n',
      },
    ]);
    expect(r.success).toBe(true);
    expect(
      await readFile(join(root, 'src/checkout/discount.ts'), 'utf8')
    ).toContain('toUpperCase');
    expect(
      await readFile(join(root, 'src/checkout/case.test.ts'), 'utf8')
    ).toContain('case-insensitive');
  });

  it('refuses to overwrite an existing file with create', async () => {
    const r = await applyEdits(root, [
      { path: 'src/checkout/discount.test.ts', create: 'gone' },
    ]);
    expect(r.success).toBe(false);
    expect(
      await readFile(join(root, 'src/checkout/discount.test.ts'), 'utf8')
    ).toContain('works');
  });

  it('writes nothing when one edit of several fails', async () => {
    const r = await applyEdits(root, [
      { path: 'src/checkout/discount.ts', search: 'CODES[code]', replace: 'x' },
      { path: 'src/checkout/discount.ts', search: 'not there', replace: 'x' },
    ]);
    expect(r.success).toBe(false);
    expect(
      await readFile(join(root, 'src/checkout/discount.ts'), 'utf8')
    ).toContain('CODES[code]');
  });

  it.each(['../outside.ts', '/etc/passwd'])('refuses path %s', async (path) => {
    expect(
      (await applyEdits(root, [{ path, search: 'a', replace: 'b' }])).success
    ).toBe(false);
    expect((await applyEdits(root, [{ path, create: 'b' }])).success).toBe(
      false
    );
  });

  it('refuses paths through a symlink a test run planted', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'outside-'));
    await writeFile(join(outside, 'secret.ts'), 'token = 1');
    await symlink(outside, join(root, 'src', 'link'));
    expect(
      (
        await applyEdits(root, [
          { path: 'src/link/secret.ts', search: 'token', replace: 'x' },
        ])
      ).success
    ).toBe(false);
    expect(
      (await applyEdits(root, [{ path: 'src/link/new.ts', create: 'x' }]))
        .success
    ).toBe(false);
    expect(await readFile(join(outside, 'secret.ts'), 'utf8')).toBe(
      'token = 1'
    );
    await rm(outside, { recursive: true, force: true });
  });
});
