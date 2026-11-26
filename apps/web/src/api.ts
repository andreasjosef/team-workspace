import {
  CreateTaskResponse,
  ErrorBody,
  fail,
  Incident,
  ok,
  paths,
  ProductDoc,
  RoleSummary,
  TaskSnapshot,
  type CreateTaskInput,
  type Result,
} from '@app/shared';
import { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 1_000 } },
});

// Every call returns a Result; a failed response's { code, message } body
// becomes the Failure.
const call = async <T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T> | null
): Promise<Result<T>> => {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return fail('unavailable', String(err));
  }
  if (!res.ok) {
    const body = ErrorBody.safeParse(await res.json().catch(() => null));
    return body.success
      ? fail(body.data.code, body.data.message)
      : fail('unexpected', `HTTP ${res.status}`);
  }
  if (!schema) return ok((await res.text()) as T);
  const parsed = schema.safeParse(await res.json());
  return parsed.success
    ? ok(parsed.data)
    : fail('unexpected', 'The response did not match the contract');
};

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  roles: () => call(paths.roles, {}, z.array(RoleSummary)),
  docs: () => call(paths.docs, {}, z.array(ProductDoc)),
  incidents: () => call(paths.incidents, {}, z.array(Incident)),
  tasks: () => call(paths.tasks, {}, z.array(TaskSnapshot)),
  task: (id: string) => call(paths.task(id), {}, TaskSnapshot),
  diff: (id: string) => call<string>(paths.diff(id), {}, null),
  createTask: (input: CreateTaskInput) =>
    call(paths.tasks, post(input), CreateTaskResponse),
};

// Where a Result becomes a throw, for TanStack Query.
export const unwrap = <T>(r: Result<T>): T => {
  if (r.success) return r.value;
  throw new Error(r.message);
};

export const eventsUrl = (id: string, after: number) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${paths.events(id)}?after=${after}`;
};
