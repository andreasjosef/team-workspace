import type { CreateTaskInput, RolePolicy, TaskEvent } from '@app/shared';

// What a runner gets for one task. The mock runner and the real pipeline both
// implement TaskRunner, so the API and UI can't tell them apart.
export type TaskHandle = {
  id: string;
  input: CreateTaskInput;
  policy: RolePolicy;
  rolePrompt: string;
  emit: (event: TaskEvent) => void;
  setDiff: (diff: string) => void;
};

export type TaskRunner = {
  // created → working → proposed | gave_up | flagged
  run: (task: TaskHandle) => Promise<void>;
  // approved → deployed. Called only by the hub, only after approval.
  deploy: (task: TaskHandle, diff: string) => Promise<void>;
};
