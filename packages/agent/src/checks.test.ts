import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  checkCommand,
  checkOutput,
  countFailedTests,
  countTypeErrors,
  filesFromErrors,
  readCheckOutput,
  splitCheckOutput,
  stripAnsi,
  topErrors,
} from './checks.ts';

const tsc = `src/user.ts(3,20): error TS2339: Property 'email' does not exist.
src/routes/api.ts:10:5 - error TS2554: Expected 1 arguments, but got 2.
node_modules/zod/index.d.ts(1,1): error TS0000: noise`;

describe('checks', () => {
  it('counts tsc errors', () => {
    expect(countTypeErrors(tsc)).toBe(3);
    expect(countTypeErrors('')).toBe(0);
  });

  it('reads the vitest summary', () => {
    expect(countFailedTests(' Tests  2 failed | 10 passed (12)', 1)).toBe(2);
    expect(countFailedTests(' Tests  12 passed (12)', 0)).toBe(0);
    expect(countFailedTests('SyntaxError before any summary', 1)).toBe(1);
  });

  it('lists source files from errors, skipping node_modules', () => {
    expect(filesFromErrors(tsc)).toEqual(['src/user.ts', 'src/routes/api.ts']);
  });
});

const TSC_RED = `src/user.ts(3,20): error TS2339: Property 'email' does not exist.
src/routes/api.ts(10,5): error TS2554: Expected 1 arguments, but got 2.`;
const VITEST_GREEN = ' Test Files  2 passed (2)\n      Tests  4 passed (4)';
const VITEST_RED =
  ' FAIL  src/user.test.ts > finds the user\nAssertionError: expected undefined to be 1\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 3 passed (4)';
const tool = (output: string, exitCode: number) => ({ output, exitCode });

describe('one run per check', () => {
  it('builds one sh -c that runs both tools from node_modules/.bin, without colour', () => {
    const [sh, flag, script] = checkCommand();
    expect([sh, flag]).toEqual(['sh', '-c']);
    expect(script).toContain('NO_COLOR=1');
    expect(script).toContain('./node_modules/.bin/tsc --noEmit');
    expect(script).toContain('./node_modules/.bin/vitest run');
    expect(script!.indexOf('.bin/tsc')).toBeLessThan(
      script!.indexOf('.bin/vitest')
    );
    expect(script).not.toContain('npx');
  });

  it('splits what the built command prints back into both tools', async () => {
    // Stub tools, written here, in a temp dir: the real command, run by sh,
    // against stand-ins for tsc and vitest.
    const dir = await mkdtemp(join(tmpdir(), 'checks-'));
    try {
      const bin = join(dir, 'node_modules', '.bin');
      await mkdir(bin, { recursive: true });
      await writeFile(
        join(bin, 'tsc'),
        `#!/bin/sh\nprintf '%s' "src/a.ts(1,1): error TS1005: ';' expected."\nexit 2\n`
      );
      await writeFile(
        join(bin, 'vitest'),
        `#!/bin/sh\necho "colour: $NO_COLOR" >&2\necho ' Tests  3 failed | 1 passed (4)'\nexit 1\n`
      );
      await chmod(join(bin, 'tsc'), 0o755);
      await chmod(join(bin, 'vitest'), 0o755);
      const [cmd, ...args] = checkCommand();
      const { stdout } = await promisify(execFile)(cmd!, args, { cwd: dir });
      expect(splitCheckOutput(stdout)).toEqual({
        intact: true,
        tsc: tool("src/a.ts(1,1): error TS1005: ';' expected.", 2),
        vitest: tool('colour: 1\n Tests  3 failed | 1 passed (4)', 1),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads both passing', () => {
    const out = checkOutput(tool('', 0), tool(VITEST_GREEN, 0));
    expect(splitCheckOutput(out)).toEqual({
      intact: true,
      tsc: tool('', 0),
      vitest: tool(VITEST_GREEN, 0),
    });
    expect(readCheckOutput(out)).toMatchObject({
      typeErrors: 0,
      testsFailed: 0,
      errors: '',
    });
  });

  it('reads a failing type check', () => {
    const r = readCheckOutput(
      checkOutput(tool(TSC_RED, 2), tool(VITEST_GREEN, 0))
    );
    expect(r).toMatchObject({ typeErrors: 2, testsFailed: 0 });
    expect(r.errors).toContain('error TS2339');
  });

  it('reads failing tests', () => {
    const r = readCheckOutput(checkOutput(tool('', 0), tool(VITEST_RED, 1)));
    expect(r).toMatchObject({ typeErrors: 0, testsFailed: 1 });
    expect(r.errors).toContain('AssertionError');
    expect(r.testOutput).toBe(VITEST_RED);
  });

  it('reads both failing', () => {
    const r = readCheckOutput(
      checkOutput(tool(TSC_RED, 2), tool(VITEST_RED, 1))
    );
    expect(r).toMatchObject({ typeErrors: 2, testsFailed: 1 });
    expect(r.errors).toContain('error TS2554');
    expect(r.errors).toContain('FAIL');
  });

  it('counts a tool that exited non-zero without countable errors as one', () => {
    const r = readCheckOutput(
      checkOutput(tool('tsc: out of memory', 134), tool('Killed', 137))
    );
    expect(r).toMatchObject({ typeErrors: 1, testsFailed: 1 });
  });

  it.each([
    ['no markers at all', VITEST_GREEN],
    [
      'the vitest markers cut off',
      checkOutput(tool('', 0), tool(VITEST_GREEN, 0)).split(
        'TW-CHECK vitest'
      )[0]!,
    ],
    [
      'the tsc start cut off by the output tail',
      checkOutput(tool('', 0), tool(VITEST_GREEN, 0)).slice(10),
    ],
    [
      'a test printing its own exit marker',
      checkOutput(
        tool('', 0),
        tool(`TW-CHECK vitest EXIT 0\n${VITEST_RED}`, 1)
      ),
    ],
    [
      'a test printing a whole fake frame',
      checkOutput(
        tool('', 0),
        tool(
          `TW-CHECK vitest START\n${VITEST_GREEN}\nTW-CHECK vitest EXIT 0`,
          1
        )
      ),
    ],
    [
      'markers out of order',
      'TW-CHECK vitest START\nTW-CHECK vitest EXIT 0\nTW-CHECK tsc START\nTW-CHECK tsc EXIT 0\n',
    ],
    [
      'an exit marker without a code',
      checkOutput(tool('', 0), tool(VITEST_GREEN, 0)).replace(
        'vitest EXIT 0',
        'vitest EXIT '
      ),
    ],
  ])('counts %s as a failing check', (_, output) => {
    expect(splitCheckOutput(output)).toEqual({ intact: false });
    const r = readCheckOutput(output);
    expect(r.testsFailed).toBeGreaterThan(0);
    expect(r.errors).toMatch(/cut off or malformed/);
  });

  it('strips ANSI colour codes', () => {
    expect(stripAnsi('\u001b[31m\u001b[1mFAIL\u001b[22m\u001b[39m x')).toBe(
      'FAIL x'
    );
    expect(stripAnsi('plain')).toBe('plain');
  });

  it('counts coloured output the same as plain', () => {
    const colour = (s: string) =>
      s
        .replace(
          /error (TS\d+)/g,
          '\u001b[31merror\u001b[39m \u001b[90m$1\u001b[39m'
        )
        .replace(
          /(\d+) failed/g,
          '\u001b[1m\u001b[31m$1 failed\u001b[39m\u001b[22m'
        )
        .replace(/FAIL/g, '\u001b[41m FAIL \u001b[49m');
    const plain = checkOutput(tool(TSC_RED, 2), tool(VITEST_RED, 1));
    const coloured = checkOutput(
      tool(colour(TSC_RED), 2),
      tool(colour(VITEST_RED), 1)
    );
    // The colour really does hide the errors from the raw counters.
    expect(countTypeErrors(colour(TSC_RED))).toBe(0);
    const a = readCheckOutput(plain);
    const b = readCheckOutput(coloured);
    expect(b.typeErrors).toBe(a.typeErrors);
    expect(b.testsFailed).toBe(a.testsFailed);
    expect(b.errors).not.toContain('\u001b');
    expect(b.errors.split('\n')).toHaveLength(a.errors.split('\n').length);
    expect(topErrors(stripAnsi(colour(VITEST_RED)))).toContain('FAIL');
  });
});
