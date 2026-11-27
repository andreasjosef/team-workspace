# Architecture

One Vultr VM. The hub holds the secrets and a clone of the product repo, which follows GitHub's `main`; changes reach `main` only through a pull request a developer merges on GitHub. Untrusted code (the product's tests, whatever an agent writes) only ever runs in short-lived sandbox containers that hold no secrets. Untrusted _text_ (customer reports, any task description) only ever reaches a model, never a decision.

```
                     internet
                        │ 443
                ┌───────▼────────┐
                │ Caddy (host)   │  TLS, serves apps/web/dist, proxies /api (REST + WS)
                └───────┬────────┘
                        │ 127.0.0.1:3000
 ┌──────────────────────▼──────────────────────────┐
 │ Hub (apps/hub, systemd, user `hub`)             │   holds: VULTR_INFERENCE_API_KEY, GITHUB_TOKEN
 │  roles from .hub/ → task queue → task loop      │──────────▶ Vultr Serverless Inference
 │  green → push task/<id> → pull request          │──────────▶ GitHub demo repo (fetch main,
 │  hub repo checkout (trusted) + task worktrees   │            push task/*, open PR; never merge)
 └───────┬───────────────────────────┬─────────────┘
         │ docker run (per command)  │ GET /denied (127.0.0.1:8081)
 ┌───────▼─────────────┐   ┌─────────▼──────────┐   ┌──────────────┐
 │ sandbox container   │──▶│ egress-proxy       │──▶│ verdaccio    │──▶ registry.npmjs.org
 │ /work = task's copy │   │ GET/HEAD to        │   │ local mirror │
 │ network: `sandbox`  │   │ verdaccio:4873 only│   └──────────────┘
 │ (install) or none   │   └────────────────────┘
 └─────────────────────┘
```

## Roles

A role is a policy file in the product repo, `.hub/roles/<role>.json`, read at start-up and after every sync (`apps/hub/src/hub/load.ts`), plus a system prompt in `.hub/prompts/`.

```json
{
  "name": "cs",
  "canCreate": ["bug"],
  "write": {
    "allow": ["src/**"],
    "deny": ["src/auth/**", "src/billing/**", "infra/**", "package.json"]
  },
  "maxChangedLines": 80,
  "approval": "dev"
}
```

- **Re-read before every task**, after the sync to origin's `main`: a role a developer changed on GitHub applies from the next task on, also to tasks already queued. A merged `main` that doesn't load (a broken role file) is rolled back to the last `main` that did, and the task log says so.
- **Enforced on every proposed edit** by `checkPolicy` (`packages/agent/src/policy.ts`), before anything is written. The prompt explains the scope; this holds the model to it.
- **Deny wins over allow.** `*` stays in one directory, `**` crosses directories, `dir/**` includes `dir`.
- **`.hub/` is never agent-writable**, whatever a role file says, so a ticket can't talk an agent into widening its own scope. Policies change only through a pull request a developer merges on GitHub.
- **No approval in the hub:** a green task opens a pull request, and a developer merges it on GitHub. The role file's `approval` field is ignored (spec 5 removes it).
- **No auth in the demo.** The UI sends the role it's showing. Say so when demoing.

## A task

One task is one request from one role, and it ends `pr_opened` (green, a pull request waits for a developer), gave up, flagged, or errored. A task whose text the input scanner flagged never opens a pull request: where it would, it ends flagged. Code: `apps/hub/src/tasks/pipeline.ts` (real) and `mockRunner.ts` (scripted).

| Phase    | Where   | Network             | What                                                                                                                                                                                                                                                                                                                   |
| -------- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| context  | host    | GitHub (fetch)      | Sync: fetch origin's `main`, reset the hub checkout to it, reload roles and decisions, clone into the task workspace (separate git dir), all under one lock (`hubSync.ts`); a failed fetch is logged and the task goes on from the last good `main`. Then scan the task text; rank source files; pick linked decisions |
| baseline | sandbox | registry only       | Install (or mount the cached install of the same lockfile), then typecheck + tests with **no network**; records the starting counts                                                                                                                                                                                    |
| fix      | sandbox | none                | Propose → role policy → guardrails → apply on host → check. A bug goes reproduce, then fix (below). Halts on 3 refusals or a network attempt                                                                                                                                                                           |
| preview  | sandbox | none (inbound only) | Not wired yet: see [Previews](#previews)                                                                                                                                                                                                                                                                               |
| publish  | host    | GitHub (push + API) | Green only: `checkPatch` again, then the `Publisher` (`publisher.ts`): a fresh worktree on `task/<id>` at the base SHA, `git apply --index` + commit. Never `main`. With `GITHUB_REPO`: push the branch (token via `GIT_ASKPASS`, that one process only), open the pull request, label it (best effort)                |

```
queued → working → pr_opened
                 ↘ gave_up
                 ↘ flagged
                 ↘ error (also: patch refused or publishing failed)
```

Once the status is final, the hub drafts a reply for the support rep (a `reply_draft` event, never a status change): one more model call for `pr_opened`, `gave_up` and `error`, with the report only inside `wrapUntrusted`; a fixed template for `flagged`. `checkReplyDraft` (`packages/agent/src/reply.ts`) holds a model draft to plain text, 1200 characters, no URLs, email addresses or promised dates, and a fix in review never described as shipped; a draft that breaks a rule, fails or times out is the template. The hub never sends it.

"Green" means no more type errors and failing tests than the baseline, **and** at least one accepted proposal: a task starts green, so the plain stop rule would end it before it did anything (`runTaskLoop` in `packages/agent/src/fixLoop.ts`).

A bug task goes in two steps, enforced by the loop rather than asked for in the prompt; the step comes from the loop's state, never from the task text:

- **Reproduce:** the answer may only create new test files. They're applied and checked; the loop goes on only if more tests fail than at the baseline. Otherwise they're deleted from the worktree (and never reach the diff) and the answer is rejected. This holds even when the baseline already has failing tests (spec 1, open questions).
- **Fix:** anything the role's scope allows, except the reproduction. The stop rules count from the reproduction's check, since it raised the count on purpose.

The role policy sees every answer before the step rule, so a step never hides an out-of-scope edit from the refusal count.

Every state change is a `status` event on the task's stream, so the snapshot the API serves is derived from the audit trail, never stored beside it (`tasks/store.ts`).

## Context

What the agent sees, all of it listed on the task's receipt:

1. The task text, inside `<untrusted>` markers (`wrapUntrusted`), with any marker it contains defused
2. The role's prompt and its scope in plain words (`describeScope`)
3. Source files ranked by task keywords, keeping only those within half the best score (`rankFiles`)
4. Decisions whose `files:` list names one of those files, then decisions whose title matches (`matchDecisions`)
5. After the first edit: the current errors and the files they point at

Decisions are markdown files in `decisions/` with front matter (`id`, `title`, `date`, `by`, `files`), versioned with the code they explain.

## Containment, and where each rule lives

| Concern             | How                                                                                                                                                                                                                            | Code                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Untrusted text      | Wrapped and labelled as data in the prompt. `scanTaskInput` flags instruction overrides, secret names, elevated access, URLs, shell commands, encoded blobs. It flags; the rows below are the protection                       | `packages/agent/src/inputScan.ts`                |
| Write scope         | Role policy on every edit, all or nothing; every refusal is a `policy_refused` event; 3 refusals flag the task                                                                                                                 | `policy.ts`, `pipeline.ts`                       |
| Edits               | Search/replace on existing files or create new ones. No changes to existing tests, lockfiles, `node_modules`, `.git`; no big deletions; no paths through symlinks; a create never overwrites                                   | `edits.ts`, `safePath.ts`                        |
| Process isolation   | One container per command, `--init`, gVisor via `SANDBOX_RUNTIME=runsc` when available                                                                                                                                         | `packages/sandbox/src/args.ts`                   |
| Secrets             | Container env built from scratch. No env files, no npmrc, no mounts but `/work` and the dependency cache entry (read-only)                                                                                                     | `buildRunArgs`                                   |
| Network             | Install: internal `sandbox` network whose only reachable service is the proxy (GET/HEAD to Verdaccio). Checks and fixes: `--network none`. A test run that tries to connect anyway is reported as `blocked` and halts the task | `apps/egress-proxy`, `pipeline.ts`               |
| Resources           | 1 GB, 1 CPU, 256 pids, 120 s per command, read-only root, `--cap-drop ALL`, `no-new-privileges`, non-root uid                                                                                                                  | `args.ts`, `run.ts`                              |
| What gets proposed  | The diff holds only paths the agent edited through the policy check. Anything else a test run wrote in the worktree (`.hub/` included) never reaches it                                                                        | `diffPaths` in `workspace.ts`                    |
| What gets published | Only a green task's diff, on its own branch. `checkPatch` re-checks every path against the role, and refuses symlinks, binary patches and mode changes. `git apply` runs in a fresh worktree of the hub repo, never on `main`  | `pipeline.ts`, `publishBranch` in `workspace.ts` |
| Audit               | Every command, edit, refusal, block, pull request and status change is an event on the task's stream                                                                                                                           | `TaskEvent` in `packages/shared`                 |

## Dependency cache

A task with a `package-lock.json` doesn't install into its worktree. The hub hashes the lockfile (SHA-256) and looks for `DEPS_CACHE_DIR/<hash>`:

- **Hit:** that folder is mounted read-only at `/work/node_modules` for every check; no install runs.
- **Miss:** `npm ci` runs in a scratch folder beside the entries (registry-only network), then the same vetting as any install: exit code, the proxy's denied log, the install-script scanner on the scratch `node_modules`. Only if all pass does one `rename` make it the entry; if another task got there first, its entry is kept and the scratch copy deleted. Any failure ends the task as an error and leaves the cache as it was.
- **No lockfile:** `npm install` into the worktree, uncached.

A changed lockfile is a different hash, so it never reuses an install made from another one. The host only hashes, copies the two manifest files, renames and deletes folders (`apps/hub/src/tasks/depsCache.ts`). Vitest writes into `node_modules` by default, so the check runs it with `--no-cache --configLoader runner` (`checkCommand`); the mount never becomes writable.

## Host-side traps the design avoids

The sandbox can write anything under `/work`, and the host later reads that directory and runs git on it:

- **Git config injection.** The task clone uses `--separate-git-dir` outside the mount and deletes the `.git` pointer; every host git call passes `--git-dir`, `--work-tree`, `core.hooksPath=/dev/null`, `core.fsmonitor=false`, `--no-ext-diff` and `--no-textconv`.
- **Patches landing in the wrong tree.** With `--work-tree`, `git apply` and pathspecs resolve against the current directory: run from the hub's own directory, a patch lands in the hub's source. Every git call runs from inside the tree it targets (found by `workspace.git.test.ts`).
- **Symlink escapes.** `resolveInside` and `resolveNewInside` refuse any path that resolves through a symlink; `checkPatch` refuses patches that create one.
- **Input injection.** Task input is validated by `CreateTaskInput` (known role and kind, length caps, a strict incident id) and commands are argv arrays, never a shell.

## Previews

**Dropped** with the move to support-only ([docs/ticket-to-pr](ticket-to-pr/README.md)): there's no PO role to preview for. Kept here in case it comes back. Planned, not built. A preview is the product running from a task's worktree, so it runs untrusted code reachable from the internet:

- one container per task on an internal `previews` network: no egress, no secrets, the same caps;
- Caddy routes `<id>.preview.<domain>` to it (wildcard certificate, or `sslip.io` subdomains);
- stopped when the task is decided.

Check on the VM that the host can reach containers on an internal network before building on it.

## Security checklist (handbook `security/approach.md`)

| Question     | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Doors        | 443/80 through Caddy (web + `/api`), SSH. The hub, Verdaccio (4873) and the proxy admin port (8081) bind to 127.0.0.1 only. The app is public and unauthenticated: anyone can start tasks and pick any role. Previews, once built, add one public door per task.                                                                                                                                                                                                                                                                                                                           |
| Credentials  | `VULTR_INFERENCE_API_KEY` and `GITHUB_TOKEN` in `/opt/team-workspace/.env` (mode 600, owner `hub`), from the password manager; revoke both after the event. The GitHub token is fine-grained, for the one demo repo: Contents and Pull requests read/write, Metadata read, nothing else (a failed label only logs), with an expiry. It reaches only the push's git process (`GIT_ASKPASS`, that one process's env) and the API's bearer header: never git config, a remote URL, a workspace or a sandbox. The fetch of a public demo repo needs no token                                   |
| Blast radius | A sandbox escape lands as the hub's uid, which is in the `docker` group (root-equivalent), on a box with the inference key, the GitHub token and the hub repo. gVisor shrinks the escape odds. A bug in the hub API has the same reach. On GitHub, the token can push branches and open, label and close pull requests on the demo repo, nothing more: the ruleset on `main` (pull request with 1 approving review, no force push, no deletion, empty bypass list) refuses a push to `main` and a merge, whoever holds the token. The VM holds nothing else; throw it away after the event |
| Abuse        | Public task creation costs tokens and CPU: 5 tasks/min per client, at most 2 running and 10 waiting, 6 iterations per task. Every green task opens a pull request, so a flood shows up as noise on the demo repo, never as a change to `main`: the demo repo is disposable, and the hub needs auth before it points at a real one                                                                                                                                                                                                                                                          |
| Detection    | systemd journal for the hub, `docker compose logs egress-proxy` for refused requests, the task event streams. Someone watches during the demo.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Recovery     | Tasks are in memory: restart the hub. `deploy/reset-demo.sh` closes the hub's open pull requests and deletes the `task/*` branches on GitHub; `main` only changes through a merged pull request, so a bad merge is reverted with another one, never a force push. A leaked token: revoke it on GitHub and put a new one in `.env`. Rebuild = new VM + `deploy/setup-vm.sh` + `docs/deploying.md`                                                                                                                                                                                           |

## Known gaps

- **No auth.** Roles are picked in the UI, so anyone can start a task as any role. The scope check is real, the identity behind it isn't. What reaches `main` doesn't depend on it: GitHub's ruleset and a developer's review do.
- **Path scopes are coarse.** They limit where code changes, not what it does: a CS edit in `src/checkout/` can still call billing code. The developer's review of the pull request is the gate for behaviour.
- **The input scanner is a heuristic.** It's there to warn the reviewer, not to stop anything.
- **Prod runs merged code** with whatever secrets prod needs. Past the merge, the sandbox no longer protects anything.
- **Overlapping pull requests:** two tasks touching the same file open two pull requests from the same base; the second may conflict once the first is merged. A developer resolves it on GitHub; the hub doesn't rebase.
- **The demo repo must be public.** The fetch of origin's `main` uses no token; with a private repo every fetch fails and tasks start from the last local `main`.
- **`origin` and `GITHUB_REPO` aren't checked against each other.** The push goes to the hub repo's `origin`, the pull request to `GITHUB_REPO`; set them to the same repo (`docs/deploying.md`).
- **Denied-request attribution is by time window** (from the upgrade agent): with two tasks installing at once, a refused request could show on the wrong task.
