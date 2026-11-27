import { fail, ok, type Result } from '@app/shared';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { resolveInside, resolveNewInside } from './safePath.ts';

// What the LLM must answer with. Search/replace on existing files (models get
// these right far more often than unified diffs, and a search that doesn't
// match exactly once is easy to reject), or a whole new file.
export const ReplaceEdit = z.object({
  path: z.string().min(1),
  search: z.string().min(1),
  replace: z.string(),
});
export const CreateEdit = z.object({
  path: z.string().min(1),
  create: z.string(),
});
export const Edit = z.union([ReplaceEdit, CreateEdit]);
export type Edit = z.infer<typeof Edit>;

export const isCreate = (e: Edit): e is z.infer<typeof CreateEdit> =>
  'create' in e;

export const EditsResponse = z.object({
  // One or two sentences: what the model is doing. Shown in the log.
  reasoning: z.string().optional(),
  edits: z.array(Edit).min(1).max(20),
});
export type EditsResponse = z.infer<typeof EditsResponse>;

// The other valid answer: the model won't change anything (the behaviour is
// intended, the problem can't be reproduced from the code, or the report asks
// for something it won't do). The reason is required; a stop has no edits.
export const StopAnswer = z.object({
  action: z.literal('stop'),
  reasoning: z.string().optional(),
  reason: z.string().trim().min(1),
});
export type StopAnswer = z.infer<typeof StopAnswer>;

export type Answer = EditsResponse | StopAnswer;

export const isStop = (a: Answer): a is StopAnswer =>
  'action' in a && a.action === 'stop';

// Pulls the JSON object out of a model reply (models like to wrap it in
// ```json fences or add a sentence) and validates it: a stop answer when
// `action` is "stop", an edit answer when there's no `action`, so prompts
// and fixtures from before the stop answer keep working. Anything else is
// rejected, never obeyed.
export const parseAnswer = (text: string): Result<Answer> => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return fail('invalid', 'The reply holds no JSON object');
  }
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return fail('invalid', `The reply is not valid JSON: ${String(err)}`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return fail('invalid', 'The reply is not a JSON object');
  if ('action' in json) {
    if (json.action !== 'stop')
      return fail(
        'invalid',
        `Unknown "action" ${JSON.stringify(json.action)?.slice(0, 40)}: answer with edits and no "action", or with "action": "stop" and a reason`
      );
    if ('edits' in json)
      return fail(
        'invalid',
        'A "stop" answer carries no edits: stop with a reason, or propose edits without "action"'
      );
    const stop = StopAnswer.safeParse(json);
    return stop.success
      ? ok(stop.data)
      : fail(
          'invalid',
          `A "stop" answer needs a non-empty "reason": ${stop.error.message}`
        );
  }
  const parsed = EditsResponse.safeParse(json);
  return parsed.success
    ? ok(parsed.data)
    : fail(
        'invalid',
        `The reply doesn't match the edit schema: ${parsed.error.message}`
      );
};

export type Guardrails = {
  // Lines added + removed across one proposal.
  maxChangedLines: number;
  // An edit that replaces this many lines or more with nothing is a deletion
  // of code, not a fix.
  maxDeletedLines: number;
  maxFileBytes: number;
};

export const defaultGuardrails: Guardrails = {
  maxChangedLines: 300,
  maxDeletedLines: 15,
  maxFileBytes: 512_000,
};

// Rules for every role, on top of the role's own write scope: the agent may
// add a new test (a bug task starts by reproducing the bug), but may not make
// tests pass by changing existing ones.
const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
// Models sometimes answer with Windows separators; every path rule compares
// the forward-slash form.
export const slashPath = (path: string) => path.replaceAll('\\', '/');
export const isTestPath = (path: string) => TEST_FILE.test(slashPath(path));
const PROTECTED =
  /(^|\/)(node_modules|\.git)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml)$/;

const lines = (s: string) => (s === '' ? 0 : s.split('\n').length);

export const changedLines = (edits: Edit[]) =>
  edits.reduce(
    (n, e) =>
      n + (isCreate(e) ? lines(e.create) : lines(e.search) + lines(e.replace)),
    0
  );

export const checkGuardrails = (
  edits: Edit[],
  limits: Guardrails = defaultGuardrails
): Result<null> => {
  for (const e of edits) {
    const path = slashPath(e.path);
    if (PROTECTED.test(path)) {
      return fail('invalid', `Editing ${e.path} is not allowed`);
    }
    if (isCreate(e)) continue;
    if (isTestPath(path)) {
      return fail(
        'invalid',
        `Changing existing tests is not allowed: ${e.path}`
      );
    }
    if (e.replace.trim() === '' && lines(e.search) >= limits.maxDeletedLines) {
      return fail(
        'invalid',
        `Deleting ${lines(e.search)} lines in ${e.path} is not allowed`
      );
    }
  }
  const changed = changedLines(edits);
  if (changed > limits.maxChangedLines) {
    return fail(
      'invalid',
      `${changed} changed lines is over the ${limits.maxChangedLines}-line cap`
    );
  }
  return ok(null);
};

export type Applied = { files: string[] };

// All or nothing: every edit is checked against the current file contents
// before any file is written. A create may not overwrite an existing file.
export const applyEdits = async (
  root: string,
  edits: Edit[],
  limits: Guardrails = defaultGuardrails
): Promise<Result<Applied>> => {
  const guard = checkGuardrails(edits, limits);
  if (!guard.success) return guard;

  const pending = new Map<string, string>();
  for (const e of edits) {
    if (isCreate(e)) {
      const resolved = await resolveNewInside(root, e.path);
      if (!resolved.success) return resolved;
      if (pending.has(resolved.value)) {
        return fail('invalid', `Created twice: ${e.path}`);
      }
      pending.set(resolved.value, e.create);
      continue;
    }
    const resolved = await resolveInside(root, e.path);
    if (!resolved.success) return resolved;
    const abs = resolved.value;
    if (!pending.has(abs)) {
      const s = await lstat(abs);
      if (!s.isFile() || s.size > limits.maxFileBytes) {
        return fail('invalid', `Not an editable file: ${e.path}`);
      }
      pending.set(abs, await readFile(abs, 'utf8'));
    }
    const content = pending.get(abs)!;
    const first = content.indexOf(e.search);
    if (first === -1) {
      return fail('invalid', `Search text not found in ${e.path}`);
    }
    if (content.indexOf(e.search, first + 1) !== -1) {
      return fail('invalid', `Search text matches more than once in ${e.path}`);
    }
    pending.set(
      abs,
      content.slice(0, first) +
        e.replace +
        content.slice(first + e.search.length)
    );
  }
  for (const [abs, content] of pending) {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return ok({ files: [...new Set(edits.map((e) => e.path))] });
};
