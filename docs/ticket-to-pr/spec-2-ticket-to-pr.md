# Spec 2 – Ticket to PR

Spec 2 of 5 for [Ticket to PR](README.md). Builds on [Spec 1](spec-1-real-pipeline-on-vm.md). Written 2026-11-24 against `main` at `a77f901`.

## Goal

When a task goes green, the hub pushes a branch and opens a pull request on GitHub, with the receipt as the PR body. Developers review and merge there. **The hub never merges, and can't.** In-hub approval goes away.

**Done when:**

- INC-1042 on the VM ends with a PR on the GitHub demo repo:
  - Branch `task/<id>` containing exactly the checked patch: reproduction test plus fix.
  - The receipt as the PR body, citing D-014.
  - The task's status is `pr_opened`, with the PR link in the snapshot.
- Each task starts from GitHub's current `main`. A change merged on GitHub shows up in the next task's context without restarting the hub.
- The hub's token **cannot** merge or push to `main`. Verified by trying it with the token and getting refused.
- Customer text in the PR body can't ping anyone, load images or render HTML.
- The approve/reject routes, the `approval` event, and the dev view's approve buttons are gone. Shared schema and UI change in one commit (AGENTS.md rule).
- The mock runner opens a fake PR, so `pnpm dev` works without GitHub.
- `pnpm lint && pnpm typecheck && pnpm test` pass. `docs/architecture.md`, `docs/deploying.md` and `AGENTS.md` describe the PR flow.

**Not in this spec:**

- Draft PRs and "works as intended" (spec 3). This spec makes the publisher _able_ to open a draft, but only the green path uses it.
- Following the PR after it opens (merged, closed). That's an open question for spec 5.
- Keys or accounts in the hub.

## Where `main` stands

- **Hub repo:** a local git checkout (`HUB_REPO_DIR`) that tasks clone from with `file://` (`branchFromHub` in `apps/hub/src/tasks/workspace.ts`). Nothing fetches it from anywhere.
- **After green:** status `proposed`, approver taken from the role policy (`"approval": "dev"`). The UI posts `/api/tasks/:id/approve` with a role picked in the browser: no auth, anyone can approve. Then `queue.deploy` → `runner.deploy`: `checkPatch` again, `applyToHub` (`git apply --index` + commit on the hub repo's `main`), reload the hub. A `TODO(deploy track)` says "push to GitHub".
- **Statuses** (`packages/shared/src/events.ts`): `queued, working, proposed, gave_up, flagged, approved, rejected, deployed, error`. Phases include `preview` and `deploy`.
- **Git hygiene already in place:** `git()` builds its env from scratch and turns off hooks, fsmonitor and file/ext protocols. Task workspaces use a separate git dir that no sandbox sees. `checkPatch` refuses symlinks, binary patches, mode changes and out-of-scope paths. Keep all of it.

## Design

### Flow after this spec

```
CS forwards → sync hub repo from GitHub → clone into task workspace → context → baseline → fix loop
   → green → checkPatch → apply on a clean branch → push task/<id> → open PR → status pr_opened
```

### 1. Hub repo follows GitHub

- On the VM, the hub repo is a normal clone of the GitHub demo repo (`HUB_REPO_DIR`).
- **Before each task:**
  - `git fetch origin main` (with the `SAFE_GIT` flags).
  - `git reset --hard origin/main` on the hub checkout.
  - `reloadHub`, so roles, prompts and decisions follow what devs merged.
- The hub never commits to its own `main` again. Its only writer is the fetch.
- **One mutex** around "fetch + reset + reload + clone into workspace", so two tasks starting together don't race. The rest of each task runs in parallel as today.
- **Fetch fails** (GitHub down, network): carry on from the last good `main`, and say so in the task log. Don't fail the task.
- **Roles now change through a dev's merged PR on GitHub.** That matches the architecture rule "policies change only through a dev's own commit." `.hub/` stays never-agent-writable.

### 2. Publishing: a clean branch with only the checked patch

The diff (`diffPaths`) already holds only the paths the agent edited. Publishing must never take anything else from the task workspace, because a sandbox wrote there.

- **Don't push from the task workspace.** It's a depth-1 clone whose worktree a sandbox could write. Instead:
  1. `checkPatch(policy, diff)` again. Refuse means status `error`, with the reason shown.
  2. `git worktree add` a fresh worktree from the hub repo, on a new branch `task/<id>` at the `origin/main` the task started from. Record that SHA when the task syncs.
  3. `git apply --index` the patch there (same flags as `applyToHub`), then commit with a fixed template:
     - Message: `fix: <sanitised title> (<incident id>)`.
     - Author: the existing hub identity.
     - No `--no-verify` needed: hooks are already off.
  4. `git push origin task/<id>`.
  5. Remove the worktree.
- The worktree lives in the host's tasks dir, never under a sandbox mount.
- **If GitHub's `main` moved during the task,** the PR simply shows it's behind. The dev or GitHub's "update branch" handles it. No rebasing in the hub.

`applyToHub` turns into `publishBranch(hubRepoDir, baseSha, branch, patch, message)` and keeps its tests (`workspace.git.test.ts`). Those tests switch from "committed to main" to "pushed to a bare repo standing in for GitHub, `main` untouched."

### 3. Opening the PR

- `POST /repos/{owner}/{repo}/pulls` with Node's `fetch`. Fields: `head: task/<id>`, `base: main`, `title`, `body`, `draft` (false here; spec 3 uses true).
- The result goes on the stream as a new event `{ type: 'pr', url, number, draft }`, then `{ type: 'status', status: 'pr_opened' }`.
- **API errors** (422 if the branch already has a PR, 401, rate limit) mean status `error` with a short reason. The branch stays pushed, so a dev can open the PR by hand.
- **Labels:** add `from-support` (and the incident id if there is one), so devs can filter. Create the label once during setup. The API call is a nice-to-have; skip it if it fails.

### 4. The PR body is the receipt

Built on the host from the task snapshot. **Two kinds of text go in it, and they're treated differently:**

| Text                                                                                                | Source                                                 | Treatment                                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Header, outcome, files, decisions, test curve (0 → 1 → 0), refused edits, blocked requests, timings | The hub                                                | Normal markdown                                                                     |
| The customer's report, the task title, the model's `reasoning`                                      | Untrusted: customer, or a model that read the customer | Inside a fenced code block, under a heading "Customer report (untrusted, verbatim)" |

**Rules for untrusted text:**

- Use a fence longer than the longest run of backticks in the text, so it can't break out.
- A fence means GitHub won't render HTML, images or links inside it, and `@mentions` don't notify anyone.
- Cap each block's length.
- The PR title is the one place untrusted text sits outside a fence. Keep it to one line: strip control characters and markdown, cap at 80 characters, replace `@` with a lookalike or remove it, and prefix it with `[support]`.

**Why it matters:** devs (and any AI reviewer bot on the repo) read this PR. A customer's "ignore previous instructions" must reach them as a quoted, labelled exhibit, never as text that looks like the hub's own words.

A pure function `buildPrBody(snapshot): { title, body }` in `apps/hub/src/tasks/`, with tests for: backtick break-out, `@mention`, HTML, an image link, very long text.

### 5. Credentials

- **A fine-grained personal access token**, scoped to the one demo repo. Permissions: Contents read/write, Pull requests read/write, Metadata read. Nothing else.
- Lives in `.env` as `GITHUB_TOKEN` (mode 600, owner `hub`), from the password manager. Revoke after the event.
- **Never stored in git config, a remote URL or a workspace.** It's passed per command only:
  - **Push:** a `GIT_ASKPASS` helper (a tiny script in the repo that prints an env var) plus the token in that child process's env. Only the push gets it.
  - **API:** `Authorization: Bearer` header from the hub process.
- **Fetch** uses the token too only if the demo repo is private. A public demo repo is simpler: fetch needs no token.
- **Never reaches a sandbox:** `buildRunArgs` already builds the sandbox env from scratch. Add a test asserting `GITHUB_TOKEN` isn't in the args, next to the existing env tests.

### 6. "Can't merge", enforced by GitHub

- A ruleset on `main` in the demo repo:
  - Pull request required, 1 approving review.
  - No force push, no deletion.
  - **Empty bypass list.** Also turn off admin bypass, since a fine-grained token acts as its owner, who may be an admin.
- Optional second ruleset: the token's owner may only create `task/*` branches.
- **Verify:**
  - `git push origin HEAD:main` with the token: refused.
  - `PUT /pulls/{n}/merge` with the token: refused.
- Note it in the README security section. This is the claim the pitch rests on.

### 7. Contract changes (one commit, hub and UI together)

| Change                                                                                                                                                          | Where                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `TaskStatus`: add `pr_opened`; remove `approved`, `rejected`, `deployed`                                                                                        | `packages/shared/src/events.ts`               |
| `Phase`: `deploy` becomes `publish`                                                                                                                             | same                                          |
| `TaskEvent`: add `pr` (`url`, `number`, `draft`); remove `approval`                                                                                             | same                                          |
| `TaskSnapshot`: add `pr: { url, number, draft } \| null`, `baseSha`; remove `approver`, `decidedBy`                                                             | `packages/shared/src/tasks.ts`                |
| Remove `DecideInput`, `/api/tasks/:id/approve` and `/reject`                                                                                                    | `tasks.ts`, `routes/tasks.ts`, `api.ts` paths |
| `TaskRunner.deploy` goes away. Publishing is the last step of `run`, behind a `Publisher` passed into the pipeline.                                             | `runner.ts`, `queue.ts`, `pipeline.ts`        |
| Role policy `approval` field: keep it in the schema for now and ignore it. Removing it means touching `demo/` and every role file: do that in spec 5's cleanup. | —                                             |
| UI: receipt shows "Pull request #N" linking to GitHub. Dev view loses approve/reject.                                                                           | `apps/web`                                    |

The **`Publisher`** interface keeps this testable:

```ts
type Publisher = {
  sync: () => Promise<{ baseSha: string; fetched: boolean }>;
  publish: (input: {
    branch: string;
    baseSha: string;
    patch: string;
    title: string;
    body: string;
    draft: boolean;
  }) => Promise<Result<{ url: string; number: number }>>;
};
```

- **Real:** git and the GitHub API.
- **Local (`GITHUB_REPO` unset):** pushes to a local bare repo or just creates the branch, and returns a `file://` "PR" URL.
- **Tests:** a bare repo and a fake API.

The mock runner emits a `pr` event with a fake URL.

### 8. Env

| Key              | Value                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GITHUB_REPO`    | `owner/name` of the demo repo. Unset means local publisher.                                                        |
| `GITHUB_TOKEN`   | The fine-grained token. Required when `GITHUB_REPO` is set and `RUNNER=real` (zod refine, like the inference key). |
| `GITHUB_API_URL` | Default `https://api.github.com`                                                                                   |

The orchestrator branch also used `GITHUB_REPO_URL`. We use `owner/name` and build the URLs ourselves.

## Steps

1. **Contract + mock first (local, no GitHub).** The schema changes, approval removed, the `Publisher` interface with the local implementation, the mock runner emitting `pr`, and the UI showing the link. One commit. `pnpm dev` shows a fake PR on INC-1042.
2. **`buildPrBody`** with its tests.
3. **Git side:** `sync` (fetch + reset + reload, behind the mutex) and `publishBranch` (worktree, apply, commit, push), tested against a local bare repo as origin.
4. **GitHub side:** the API client (open PR, labels) behind the `Publisher`, tested with a fake `fetch`.
5. **Demo repo setup** (once, by hand; worth a short checklist in `docs/deploying.md`):
   - Create the repo from `demo/shop`, tag `demo-start`.
   - Ruleset, label, token.
   - Clone it as `HUB_REPO_DIR` on the VM.
6. **On the VM:** INC-1042 end to end. PR opens, body renders right, token can't merge.
7. **Reset script** `deploy/reset-demo.sh`: closes open `from-support` PRs and deletes `task/*` branches. `main` doesn't move during a demo (nobody merges), so no force push is needed, which the ruleset forbids anyway. Tasks reset by restarting the hub.
8. **Docs:**
   - `docs/architecture.md`: diagram ("approvals → git apply + commit" becomes "green → PR"), the task table, the security checklist (credentials, blast radius, recovery).
   - `docs/deploying.md`, `.env.example`, the README.
   - `AGENTS.md`'s opening line ("changes reach `main` only after approval" becomes "only through a PR a developer merges").

## Risks

| Risk                                                    | Fallback                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Token owner is an org admin and bypass slips through    | Use a separate bot GitHub account as the token owner, with write access only. Cleanest anyway.                 |
| GitHub API down or rate-limited during the demo         | Branch still pushed. Show the branch, or record a backup video.                                                |
| PR body too long (big receipts)                         | Cap the command output sections. Link to the hub's receipt page for the rest.                                  |
| Duplicate PRs when the same incident is forwarded twice | Fine for the demo. Later: look for an open PR with that incident's label first.                                |
| The hub's `main` is reset under a running task          | Can't happen: tasks clone under the mutex, and publishing uses the recorded `baseSha`, not the current `main`. |

## Open questions

- Public or private demo repo? Public is simpler (no token for fetch) and lets judges click the PR. Recommendation: public.
- Bot account or a team member's token? Recommendation: a bot account, so "the hub can't merge" holds no matter who set it up.
- Should the PR request a reviewer automatically (CODEOWNERS or a fixed dev)? It's a nice touch for the demo: "the dev gets pinged".
