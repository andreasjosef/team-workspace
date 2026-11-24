# Spec 1 – Real Pipeline on the VM

Spec 1 of 5 for [Ticket to PR](README.md). Next: [Spec 2](spec-2-ticket-to-pr.md). Background: the review of `henrik/orchestrator-prototype` (vault: `vultur-hackton/team-workspace-orchestrator-branch.md`). Written 2026-11-24 against `main` at `a77f901`.

## Goal

The agent part of the flow runs for real: live model, real gVisor sandboxes, on the Vultr VM. Today only the mock runner plays it. This is the foundation the other specs build on.

**Done when:**

- INC-1042 (discount bug) goes from a red reproduction test to green and ends **`proposed`** with a diff ready to become a pull request. With `RUNNER=real` on the VM. (Spec 2 turns that diff into the PR.)
- INC-1043 (the hostile report) ends **flagged**, every time. We've written down which containment layers fire with the live model. That's the input for spec 4.
- We know the wall-clock time of each run, and it fits the 3-minute demo (target: INC-1042 under about 60 s, see [Speed](#speed)).
- `pnpm lint && pnpm typecheck && pnpm test` pass, and `docs/deploying.md` matches what we actually did.

**Not in this track:**

- Pushing branches and opening PRs (spec 2).
- The five outcomes (spec 3).
- The halt rule and the "what if the model obeyed?" run (spec 4).
- The support view (spec 5).
- Persistence: tasks stay in memory.

## Where `main` stands

The real pipeline is written but has never run end to end (`apps/hub/src/tasks/pipeline.ts`, header comment and README "What's left").

One task today:

1. **Context:** fresh copy of the hub repo, input scanner, files ranked by keywords, matching decisions.
2. **Baseline:**
   - `npm ci` in the sandbox with registry-only network, then check the egress proxy's denied log.
   - Then `tsc` and `vitest` as **two separate sandbox runs** with no network.
3. **Fix loop** (`runTaskLoop`, up to 6 iterations). Each iteration:
   - Model proposes edits.
   - `checkPolicy`.
   - `applyEdits`.
   - Check again (two more sandbox runs).
4. **Proposed**, then dev approval in the hub, then `deploy`: `checkPatch` again, `git apply` and commit on the hub repo. No push. (Spec 2 replaces this step with a pull request. This track stops at `proposed`.)

Known issues, from reading `main` and from what Henrik hit on his branch:

| Issue                                                                                                                | Where                                                                                                               | Evidence                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| gVisor sandboxes can't reach the egress proxy: Docker's embedded DNS doesn't work for `runsc` on an internal network | `docker-compose.yml`, `SANDBOX_PROXY_URL=http://egress-proxy:8080`                                                  | Henrik's `75198d5`: static IP `172.28.0.2` for the proxy                                                        |
| Baseline check runs twice: once in `runTask`, again as the first thing `runTaskLoop` does                            | `pipeline.ts` (`const first = await check()`) + `packages/agent/src/fixLoop.ts` (`let latest = await deps.check()`) | Henrik's `73b3a28` caches the first result                                                                      |
| Every check is 2 container boots (`tsc`, then `vitest`), each through `npx`                                          | `pipeline.ts`, `check()`                                                                                            | Henrik's `5c303df`: one `sh -c` run with direct binaries                                                        |
| `npm ci` on every task, into the task's worktree                                                                     | `pipeline.ts`, baseline                                                                                             | Henrik's warm cache keyed by lockfile hash (`ensureWarmDeps` in `gitEngine.ts`)                                 |
| Model writes `node:test` instead of Vitest for the reproduction test                                                 | `packages/agent/src/prompt.ts`                                                                                      | Henrik's `a0aa9f2` adds one line to the prompt                                                                  |
| Decision front matter fails to parse with CRLF line endings                                                          | `packages/agent/src/context.ts`, `parseDoc`                                                                         | Branch diff normalises `\r\n`                                                                                   |
| ANSI colour codes in tool output can confuse the error counters                                                      | `check()` output                                                                                                    | Branch strips ANSI and sets `NO_COLOR=1`                                                                        |
| **The live model refuses the hostile report outright** (empty edits), so the policy and network layers never fire    | `pipeline.ts` fix loop                                                                                              | Henrik's `8ccd50a` / `73b3a28`: halt as flagged when the scanner flags the input and the model returns no edits |

The last row matters most for the demo, but it belongs to spec 4. This track only makes sure INC-1043 reliably ends flagged and records what happened. See [INC-1043 in this track](#inc-1043-in-this-track).

## Work

### Step 0 – VM up (half a day, mostly waiting)

Follow `docs/deploying.md` as written: Vultr Cloud Compute, Ubuntu 24.04, 4 vCPU / 8 GB, then `deploy/setup-vm.sh`.

- **Answer:** does gVisor start containers on this VM type? The script prints it.
- **Answer:** which `INFERENCE_MODEL`? List `/v1/models` and pick one that reliably returns the JSON edit format. Try the discount task in a plain chat first.
- Write down every place the doc was wrong or missing a step. Fix the doc as part of this track.

### Step 1 – Network: sandbox reaches the proxy under gVisor

- Cherry-pick `75198d5` (`docker-compose.yml` only: fixed subnet `172.28.0.0/24`, proxy at `172.28.0.2`).
- Set `SANDBOX_PROXY_URL=http://172.28.0.2:8080` in `.env.example`, with a comment on why: no Docker DNS under `runsc` on an internal network.
- **Verify on the VM:**
  - `npm ci` in a `runsc` sandbox on the `sandbox` network installs from Verdaccio.
  - `nslookup example.com` from the sandbox still fails (from `docs/deploying.md` §5).
  - A request to anything but Verdaccio shows up in the proxy's denied log.

### Step 2 – Correctness fixes (small, local first)

Each one is a small commit that can be tested on a laptop with podman/Docker, without the VM.

1. `prompt.ts`: the Vitest line from the branch.
2. `context.ts`: CRLF normalisation in `parseDoc`, plus a test with a CRLF decision file.
3. Pass the baseline result into `runTaskLoop` instead of checking twice. Cleaner than Henrik's cache trick: give `TaskLoopDeps` an optional `first?: CheckOutcome` and use it in place of the first `check()`. Update the loop's tests.
4. Strip ANSI before counting errors (`NO_COLOR=1` in the command, plus a `stripAnsi` helper next to `topErrors` in `packages/agent`).

### Step 3 – Speed: one container per check, warm dependencies

1. **One run per check.** Replace the two `npx` runs in `check()` with one `sh -c` running `./node_modules/.bin/tsc` then `./node_modules/.bin/vitest run`. Use markers to split the output and keep both exit codes. Take the shape from `runSandboxChecks` in the branch's `gitEngine.ts`, but put the command builder and output splitter in `packages/agent/src/checks.ts`, so they're tested as pure functions.
2. **Warm, read-only `node_modules`.**
   - Port `extraMounts` to `packages/sandbox` (`args.ts`, `run.ts`) together with its test, from the branch diff.
   - In the pipeline, key a cache by the SHA-256 of the worktree's `package-lock.json`, under a new `DEPS_CACHE_DIR`.
   - On a miss: `npm ci` in a scratch dir in the sandbox with registry network (same denied-log check as today), then move `node_modules` into the cache.
   - On a hit: mount it at `/work/node_modules:ro` and skip install.
3. **Keep the install-time containment.** The egress denied-log check and the install-script scanner must still run on a cache miss. A task that changes the lockfile gets a miss and a fresh sandboxed install. It never reuses a cache built from a different lockfile.
4. **Verify:** does Vitest need to write into `node_modules` (for example `node_modules/.vite`)? If it does under `:ro`, point its cache dir at `/tmp` (config or CLI) rather than making the mount writable.

### Step 4 – Run INC-1042 for real

- Reset the hub repo (`git reset --hard demo-start`) and run it from the support view.
- Expected curve (from `demo/README.md`): 0 failing, then 1 failing (reproduction test), then 0 failing. D-014 is in the context.
- **Record:** total time, iterations, time per sandbox run, tokens if the inference API reports them.
- Check the task ends `proposed`, and the diff holds only the reproduction test and `src/checkout/discount.ts`.
- Run it 5 times. A demo needs this to work every time, not once. Note any failures and what caused them.

### Step 5 – Run INC-1043

See [INC-1043 in this track](#inc-1043-in-this-track). Run it 5 times too.

### Step 6 – Docs and checks

- Update `docs/deploying.md` (proxy IP, `DEPS_CACHE_DIR`, the model we picked), `.env.example`, and the README checklist ("What's real and what's left").
- `pnpm lint && pnpm typecheck && pnpm test`.

## INC-1043 in this track

The demo's containment beat (the halt rule and the "what if the model obeyed?" run) is spec 4. This track only needs:

- **INC-1043 ends flagged, never `proposed`,** in all 5 runs. If the live model refuses and the loop burns 6 iterations before `gave_up`, that's a finding for spec 4, not a blocker here. Note how often it happens.
- **A written record of each run:**
  - Which scanner signals fired.
  - What the model answered (refusal, partial edits, malicious edits).
  - Which policy refusals and network blocks happened.
  - How long the run took.

Henrik's experience suggests the model refuses outright. Confirming that with our model choice is what spec 4 needs to pick its approach.

## Speed

The demo gives the fixed outcome about 60 seconds of talking. Rough budget to measure against in step 4:

| Step           | Rough cost           | After this track       |
| -------------- | -------------------- | ---------------------- |
| Context        | under 1 s            | same                   |
| Install        | 10–30 s per task     | 0 s on a warm cache    |
| Baseline check | 2 boots              | 1 boot (and only once) |
| Each iteration | model call + 2 boots | model call + 1 boot    |

The numbers are guesses. Step 4 replaces them with measurements. If it's still too slow, the fallbacks are:

- Start the INC-1042 task just before the demo and narrate the receipt.
- Use `RUNNER=mock` for that beat and the real runner for the containment beat.

## Risks

| Risk                                              | Fallback                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| gVisor doesn't work on the VM type                | Try another plan, or run with `runc` and say so. The other layers still apply (no network, no secrets, caps). |
| Model output isn't reliably valid JSON edits      | Try another model, tighten the prompt, lean on the existing "invalid answer uses an iteration" rule.          |
| Read-only `node_modules` breaks a tool            | Move that tool's cache to `/tmp`. Never make the mount writable.                                              |
| Runs too slow for live                            | Pre-run and narrate, or mock for that beat.                                                                   |
| Model behaviour drifts between rehearsal and demo | Pin the model ID, and record a backup video of a good run.                                                    |

## Open questions

- Which model? (Step 0.)
- Who runs this track? It touches `packages/sandbox` and `pipeline.ts`, so read `docs/architecture.md` first (AGENTS.md rule).
- Do we keep Henrik's commits as cherry-picks with his authorship where they apply cleanly (only `75198d5`), and credit him in the commit messages for the ideas ported by hand?
