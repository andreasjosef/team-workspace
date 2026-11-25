# Agent context

What the model sees on each iteration of a task, why, and what live runs taught us. We treat this as part of the product, not plumbing: how well the agent reproduces and fixes a report depends mostly on what goes into its prompt. This file is the starting point for turning that into a system that can be measured and improved (see [Open questions](#open-questions)).

## What goes into the prompt today

Two messages per model call, built by `buildTaskMessages` in `packages/agent/src/prompt.ts`. The pipeline (`apps/hub/src/tasks/pipeline.ts`) picks what goes in.

**System message**

| Part                    | Source                                                    | Notes                                                                                                                       |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Role prompt             | `.hub/prompts/<role>.md` in the hub repo                  | Per role. Not agent-writable.                                                                                               |
| Scope                   | `describeScope(policy)` in `packages/agent/src/policy.ts` | The paths this role may and may not edit, from its role file.                                                               |
| Answer format and rules | `FORMAT` in `prompt.ts`                                   | JSON edit format, Vitest for reproductions, "follow decisions", the `<untrusted>` rule. Lives in code, not in the hub repo. |

**User message**

| Part               | Source                                                                                | Notes                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task line          | task kind, role, title                                                                |                                                                                                                                                           |
| Report             | `wrapUntrusted(task.text)`                                                            | Always inside `<untrusted>` markers. Never decides anything on the host.                                                                                  |
| Decisions          | `matchDecisions` in `packages/agent/src/context.ts`                                   | Decisions linked to a chosen file via front matter `files`, then by title keywords. At most 3.                                                            |
| Files              | `rankFiles` in `context.ts`, plus files the agent touched, plus files named in errors | Keyword and path matching over tracked `src/` files, tests excluded. At most 4 ranked files, each cut at 12,000 characters.                               |
| Current errors     | `topErrors()` of the latest check                                                     | Only after the first edit.                                                                                                                                |
| Previous rejection | the fix loop's last rejection reason                                                  | Why the last answer was refused (policy, guardrail, step rule).                                                                                           |
| Step line          | the fix loop's state (bug tasks)                                                      | "Step: reproduce" (plus the tests that already exist next to the context files) or "Step: fix" (plus the reproduction's paths). Never from the task text. |

The UI's "Context the agent got" panel shows the chosen files and decisions; it doesn't show the rest.

## Log

Newest first. Each entry: what we saw, the evidence, what we changed.

### 2026-11-25: reproduce step names the existing tests

- **Seen:** in every live INC-1042 run on the VM (4 of 4), the model's first answer tried to create `src/checkout/discount.test.ts`, which already exists. The guardrail refused it ("Already exists, edit it instead"), so every run spent one iteration and showed the curve 0, 0, 2, 0 instead of 0, 2, 0. Cost about 1.5 s per run (no sandbox boot), but the curve reads badly in the demo.
- **Cause:** the files in context exclude tests, so the model couldn't know the conventional name was taken.
- **Change:** the reproduce step line lists tracked test files in the same folders as the context files, and asks for a new file name.
- **Evidence:** run records on #10.

### Earlier (spec 1)

- **Vitest, not `node:test`** (#4): the model wrote reproductions for the wrong framework. `FORMAT` now names the Vitest import.
- **CRLF decision files** (#4): D-014 was dropped when saved with Windows line endings, so the model never saw it. `parseDoc` normalises line endings.
- **Reproduction before the fix** (#13): the model sent the test and the fix in one answer. The fix loop now enforces two steps, and the prompt says which step it's in.

## Not acted on yet

- **Tokens aren't recorded.** `packages/agent/src/inference.ts` reads only `choices[0].message.content` and drops the API's `usage` field, so we can't see what each prompt costs.
- **The checks table shows iterations that never ran a check** (a refused answer appears as a row with unchanged counts). Viewers read it as "the reproduction passed".
- **The prompt itself isn't visible anywhere.** You can reconstruct it from the code above, but there's no record of the exact messages a task sent.

## Open questions

Seeds for making this a system, not decisions:

- **Measuring.** A fixed set of reports (INC-1042, INC-1043, more) replayed against the live model, scored on outcome, curve, iterations, refusals, time and tokens. Run it before and after each context change, so a change is a measured improvement and not a hunch.
- **Where the rules live.** The role prompt is in the hub repo, but `FORMAT` and the step lines are in code. Should all prompt text be data that a team can review and change, like decisions are?
- **Who owns context.** Is tuning context a role in the workspace (with its own scope), or a developer's job?
- **Selection.** Keyword matching works for the demo repo. What should replace it on a real repo: the decision links, the import graph, the files a report's stack trace names?
- **A receipt.** Record the exact messages per iteration with the task, so a bad run can be explained and replayed.
