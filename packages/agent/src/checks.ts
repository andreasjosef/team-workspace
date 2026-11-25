// Turning tsc and vitest output into numbers for the burn-down chart, and
// into the file list the LLM gets to see.

export type CheckCounts = { typeErrors: number; testsFailed: number };

export const countTypeErrors = (tscOutput: string) =>
  (tscOutput.match(/error TS\d+:/g) ?? []).length;

// Vitest's summary: "Tests  2 failed | 10 passed (12)". A run that crashed
// before the summary (a suite that doesn't even load) counts as one failure
// per failed file, or one if nothing parses.
export const countFailedTests = (vitestOutput: string, exitCode: number) => {
  const tests = /Tests\s+(\d+)\s+failed/.exec(vitestOutput);
  if (tests) return Number(tests[1]);
  const files = /Test Files\s+(\d+)\s+failed/.exec(vitestOutput);
  if (files) return Number(files[1]);
  return exitCode === 0 ? 0 : 1;
};

// "src/user.ts(12,5): error TS2339" and "src/user.ts:12:5 - error TS2339".
// Vitest prints " ❯ src/user.test.ts:4:10". Only relative source paths; the
// caller still resolves each one inside the workspace.
export const filesFromErrors = (output: string, max = 5): string[] => {
  const found: string[] = [];
  const re =
    /(?:^|\s)((?:[\w@.-]+\/)*[\w@.-]+\.[cm]?[jt]sx?)(?:\(\d+,\d+\)|:\d+:\d+)/gm;
  for (const m of output.matchAll(re)) {
    const path = m[1]!;
    if (path.includes('node_modules') || path.startsWith('..')) continue;
    if (!found.includes(path)) found.push(path);
    if (found.length >= max) break;
  }
  return found;
};

// The top of the error output, which is what the LLM needs; the rest is
// usually the same error repeated.
export const topErrors = (output: string, maxLines = 60) =>
  output
    .split('\n')
    .filter((l) => /error TS\d+|FAIL|AssertionError|Error:|❯|×/.test(l))
    .slice(0, maxLines)
    .join('\n');

// Colour codes (CSI sequences such as "\x1b[31m") can split "error TS2339:"
// or "Tests  2 failed" apart. Stripped before counting and before the model
// sees the errors.
const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[ -/]*[@-~]`, 'g');
export const stripAnsi = (s: string) => s.replace(ANSI, '');

// ---- One sandbox run per check -------------------------------------------
//
// Type check and tests run in one `sh -c`, straight from the project's own
// node_modules/.bin (no npx), with NO_COLOR=1. Markers on lines of their own
// frame each tool's output and carry its exit code. stderr goes to stdout so
// the two streams can't reorder around a marker. The shape is Henrik's
// `runSandboxChecks` (5c303df).

const MARK = 'TW-CHECK';

export const checkCommand = (): string[] => [
  'sh',
  '-c',
  [
    'exec 2>&1',
    'export NO_COLOR=1',
    `printf '\\n${MARK} tsc START\\n'`,
    './node_modules/.bin/tsc --noEmit --pretty false',
    `printf '\\n${MARK} tsc EXIT %s\\n' "$?"`,
    `printf '\\n${MARK} vitest START\\n'`,
    './node_modules/.bin/vitest run',
    `printf '\\n${MARK} vitest EXIT %s\\n' "$?"`,
  ].join('; '),
];

// The same framing, for tests that script what the sandbox prints.
export const checkOutput = (tsc: ToolRun, vitest: ToolRun) =>
  [
    `${MARK} tsc START`,
    tsc.output,
    `${MARK} tsc EXIT ${tsc.exitCode}`,
    `${MARK} vitest START`,
    vitest.output,
    `${MARK} vitest EXIT ${vitest.exitCode}`,
    '',
  ].join('\n');

export type ToolRun = { output: string; exitCode: number };
export type SplitCheck =
  { intact: true; tsc: ToolRun; vitest: ToolRun } | { intact: false };

const EXPECTED = 'tsc START|tsc EXIT|vitest START|vitest EXIT';

// Exactly the four markers, in order, each once. Anything else (a marker
// missing, cut off by the output tail, or repeated because a test printed
// one) is `intact: false`, which counts as a failing check.
export const splitCheckOutput = (output: string): SplitCheck => {
  const marker = new RegExp(`^${MARK} (tsc|vitest) (START|EXIT (\\d+))$`, 'gm');
  const found = [...output.matchAll(marker)];
  const seen = found.map((m) => `${m[1]} ${m[2]!.split(' ')[0]}`).join('|');
  if (seen !== EXPECTED) return { intact: false };
  const between = (start: RegExpExecArray, end: RegExpExecArray): ToolRun => ({
    output: output
      .slice(start.index + start[0].length, end.index)
      .replace(/^\n/, '')
      .replace(/\n+$/, ''),
    exitCode: Number(end[3]),
  });
  const [a, b, c, d] = found as [
    RegExpExecArray,
    RegExpExecArray,
    RegExpExecArray,
    RegExpExecArray,
  ];
  return { intact: true, tsc: between(a, b), vitest: between(c, d) };
};

// The combined run as counts for the burn-down chart and errors for the
// model. A tool that exited non-zero counts at least one, so a crash is never
// a pass; neither are broken markers.
export const readCheckOutput = (
  output: string
): CheckCounts & { errors: string; testOutput: string } => {
  const clean = stripAnsi(output);
  const split = splitCheckOutput(clean);
  if (!split.intact)
    return {
      typeErrors: countTypeErrors(clean),
      testsFailed: 1,
      errors:
        `The check's output was cut off or malformed, so it counts as failing.\n${topErrors(clean)}`.trim(),
      testOutput: clean,
    };
  const { tsc, vitest } = split;
  const atLeastOne = (n: number, exitCode: number) =>
    exitCode !== 0 ? Math.max(1, n) : n;
  return {
    typeErrors: atLeastOne(countTypeErrors(tsc.output), tsc.exitCode),
    testsFailed: atLeastOne(
      countFailedTests(vitest.output, vitest.exitCode),
      vitest.exitCode
    ),
    errors: `${topErrors(tsc.output)}\n${topErrors(vitest.output)}`.trim(),
    testOutput: vitest.output,
  };
};
