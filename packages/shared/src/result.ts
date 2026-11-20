import { z } from 'zod';

// Errors as data. Expected outcomes (bad input, a patch that doesn't apply,
// an LLM answer that fails validation, a role approving what it may not) are a Failure with a code; faults (a
// bug, Docker gone) throw and reach the API's error handler.

export const ErrorCode = z.enum([
  'invalid',
  'not_found',
  'forbidden',
  'conflict',
  'unavailable',
  'unexpected',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export type Success<T> = { success: true; value: T };
export type Failure = { success: false; code: ErrorCode; message: string };
export type Result<T> = Success<T> | Failure;

export const ok = <T>(value: T): Success<T> => ({ success: true, value });

export const fail = (code: ErrorCode, message: string): Failure => ({
  success: false,
  code,
  message,
});
