import { z } from 'zod';
import { ErrorCode } from './result.ts';

// The REST + WebSocket surface, written once. The hub registers exactly these
// paths and the web app calls them.
export const paths = {
  roles: '/api/roles', // GET → RoleSummary[]
  docs: '/api/docs', // GET → ProductDoc[]
  incidents: '/api/incidents', // GET → Incident[]
  tasks: '/api/tasks', // GET → TaskSnapshot[] · POST CreateTaskInput → CreateTaskResponse
  task: (id: string) => `/api/tasks/${id}`, // GET → TaskSnapshot
  diff: (id: string) => `/api/tasks/${id}/diff`, // GET → text/x-diff
  events: (id: string) => `/api/tasks/${id}/events`, // WS → EventEnvelope*
} as const;

// The body of every failed response.
export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  requestId: z.string().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;
