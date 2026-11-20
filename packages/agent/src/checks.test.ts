import { describe, expect, it } from 'vitest';
import {
  countFailedTests,
  countTypeErrors,
  filesFromErrors,
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
