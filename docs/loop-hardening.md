# Fix loop hardening: shared understanding

What we agree on about the fix loop's weak spots, before we spec the hardening. It starts from Henrik's review ([`docs/loop-improvements.md` on `henrik/ui-ux`](https://github.com/andreasjosef/team-workspace/blob/henrik/ui-ux/docs/loop-improvements.md), in Swedish), with each claim checked against `main` at `29118aa`. The loop code hasn't changed since the review's base (`007f7ea`). Findings from live runs stay in [`agent-context.md`](agent-context.md).

Files: `packages/agent/src/fixLoop.ts`, `stop.ts`, `checks.ts`, `edits.ts`, `prompt.ts`, `apps/hub/src/tasks/pipeline.ts`.

## 1. A broken reproduction gets locked: confirmed, and it can never go green

- The reproduce step moves on to fix as soon as `testsFailed > baseline.testsFailed` (`fixLoop.ts`). It never looks at `typeErrors`.
- `countFailedTests` counts a suite that doesn't load (bad import, syntax error) as one failed test.
- `demo/shop/tsconfig.json` includes all of `src`, so `tsc` checks test files too. A reproduction with a type error raises `typeErrors`, passes the gate and gets locked ("The reproduction must not change").
- `isGreen` needs `typeErrors <= baseline`, and the error sits in a file the agent may no longer edit. So the run can't go green, unless the model bends production code to fit the broken test, which is worse.

**Agreed:**

- Accept a reproduction only if `typeErrors <= baseline.typeErrors`. Otherwise discard it and send the errors back, as for a reproduction that passes.
- Accept a reproduction only if at least one test fails (a `Tests N failed` line), not just a suite that didn't load (`Test Files N failed` or a non-zero exit). A crash inside the code under test still counts: it fails a test, and for a crash bug that's the reproduction.

**Not agreed:** rejecting `as never` / `as any` in reproductions. It's easy to get around (`as unknown as X`, `@ts-expect-error`), and it misses the real INC-1043 problem: a made-up bug as a perfectly typed test. The answer to that is not reproducing flagged reports at all (section 4).

## 2. No way to answer "no edit": confirmed

- `EditsResponse` requires `edits: z.array(Edit).min(1)`, so "this is intended", "I can't reproduce this" and "I won't follow this report" are all invalid answers. With nothing else valid, the model invents a bug (INC-1043).
- **Not the same problem:** the empty replies in 4 of 5 INC-1043 runs came from the inference API (no content after 40–45 s), not from a model choosing not to edit. A schema change doesn't fix those. We need `finish_reason` from `inference.ts` to see why they happen.
- The full set (`explain` with a decision id, `cannot_reproduce`, `refuse`) is spec 3's Explained and Not reproduced outcomes: new statuses in `packages/shared`, so the UI changes in the same commit.

**Agreed:**

- First step: one `action: "stop"` with a reason. The host ends the loop as `gave_up` (or `flagged` when the scanner flagged the report) and keeps the model's reason on the receipt. No shared schema change.
- Spec 3 later splits `stop` into `explain` / `cannot_reproduce` / `refuse`. For `explain`, the host checks that the decision id was in the context it sent.
- Trust stays as is: the model proposes, the host decides on host facts. A report that talks the model into `stop` only stops its own task. The opposite risk, a model that gives up on real bugs, needs measuring (the eval set in `agent-context.md`).

## 3. Rejected answers use up the stop rules: confirmed, with two more effects

- A rejected answer (bad JSON, search text not found, step rule, policy) never runs the sandbox, but the loop still adds the unchanged counts to `history` and emits an iteration. In the fix step, `patience: 2` means two rejections in a row end the run as "error count stopped falling", without one fix tried in the sandbox. The checks table shows rows that never ran.
- In the reproduce step with a green baseline, `decide` returns `green` before the patience rule, and the loop keeps going while `applied === 0`. Only `maxIterations` stops it there.
- **Also:** `maxIterations: 6` is one budget across both steps. Rejections in the reproduce step use up iterations the fix step needs.
- **Also: how a flagged report ends changes.** Today policy refusals count toward patience (2), so the loop stops before `MAX_REFUSALS = 3` (`pipeline.ts`) can halt it. Once rejections stop counting, three refusals halt the loop (`flagged`) instead of `gave_up`. That's probably right, but it's a behaviour change and needs a test.

**Agreed:**

- Rejected answers don't go into `history` and don't emit an iteration row. Patience and the curve count only sandbox checks.
- A separate cap on model calls (rejected answers included), so cost and termination stay bounded.
- Each step of a bug task gets its own `maxIterations` budget of checks (spec #41, story 12). Discarded reproductions ran in the sandbox, so they stay on the curve, but the fix step's checks and patience count from the accepted reproduction. Patience doesn't apply in the reproduce step: a reproduction raises the count on purpose.
- Later, an attempt log in the prompt: the last 2–3 iterations, so the model doesn't repeat itself. It holds only host facts (paths, rejection reasons, counts), or wraps the model's reasoning with `wrapUntrusted`: that reasoning is shaped by the customer's text, and feeding it back raw would get around the untrusted-text rule.
- Later, rollback in the fix step: if a check makes the total worse than the best so far in this step, restore the edited files, delete the created ones, roll back `touched`, and send the errors back. That's more work than the rest (snapshots, created files, `touched`), so it comes after.

## 4. A flagged report still runs the loop: it shouldn't

When the input scanner flags a report (`signals.length > 0`), the pipeline still installs dependencies, runs the baseline in a sandbox and runs the reproduce/fix loop. Then it ends `flagged` anyway: the decision is made on host facts after the loop. That costs sandbox time and model calls, and gives the model a reproduce step it can only satisfy by inventing a bug (INC-1043).

**Agreed:** a flagged report ends `flagged` before the baseline phase: no sandbox, no model call. The fixture run ("what if the model obeyed?") is the exception: it needs the loop to show the layers stopping a hostile proposal. Done in #40, which also scans the title with the text.

## Order

1. A flagged report ends before the sandbox (section 4).
2. A stricter reproduce gate: `tsc` no worse, a real failing test (section 1).
3. Rejected answers out of `history` and the curve, plus a cap on model calls (section 3).
4. `action: "stop"` (section 2).
5. Record `finish_reason` and `usage` in `inference.ts`: cheap, and needed to measure anything above.

Items 2–5 are specced in #41. Later: the attempt log, rollback on regression, and spec 3's full set of answers.
