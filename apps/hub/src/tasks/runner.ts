import type { CreateTaskInput, RolePolicy, TaskEvent } from '@app/shared';

// What a runner gets for one task. The mock runner and the real pipeline both
// implement TaskRunner, so the API and UI can't tell them apart.
export type TaskHandle = {
  id: string;
  // The branch a green task is published on: `task/<short id>`.
  branch: string;
  input: CreateTaskInput;
  policy: RolePolicy;
  rolePrompt: string;
  // A fixture run: the flagged task it is for. The runner drives it with the
  // scripted hostile proposal (fixture.ts) instead of the model, and never
  // publishes it.
  fixtureOf: string | null;
  emit: (event: TaskEvent) => void;
  setDiff: (diff: string) => void;
};

export type TaskRunner = {
  // queued → working → pr_opened | gave_up | flagged | error. Publishing
  // the pull request is the run's last step; the hub never merges.
  run: (task: TaskHandle) => Promise<void>;
};
