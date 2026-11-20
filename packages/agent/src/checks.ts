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
