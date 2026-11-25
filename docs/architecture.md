# Architecture

One Vultr VM. The hub holds the secrets and the product repo's `main`; untrusted code (the product's tests, whatever an agent writes) only ever runs in short-lived sandbox containers that hold no secrets. Untrusted _text_ (customer reports, any task description) only ever reaches a model, never a decision.

```
                     internet
                        │ 443
                ┌───────▼────────┐
                │ Caddy (host)   │  TLS, serves apps/web/dist, proxies /api (REST + WS)
                └───────┬────────┘
                        │ 127.0.0.1:3000
 ┌──────────────────────▼──────────────────────────┐
 │ Hub (apps/hub, systemd, user `hub`)             │   holds: VULTR_INFERENCE_API_KEY
 │  roles from .hub/ → task queue → task loop      │──────────▶ Vultr Serverless Inference
 │  approvals → git apply + commit to main         │
 │  hub repo checkout (trusted) + task worktrees   │
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

A role is a policy file in the product repo, `.hub/roles/<role>.json`, read at start-up (`apps/hub/src/hub/load.ts`), plus a system prompt in `.hub/prompts/`.

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

- **Enforced on every proposed edit** by `checkPolicy` (`packages/agent/src/policy.ts`), before anything is written. The prompt explains the scope; this holds the model to it.
- **Deny wins over allow.** `*` stays in one directory, `**` crosses directories, `dir/**` includes `dir`.
- **`.hub/` is never agent-writable**, whatever a role file says, so a ticket can't talk an agent into widening its own scope. Policies change only through a dev's own commit.
- **Approval:** the role named in `approval` decides on the role's tasks; `null` means the role merges its own (the dev, in the demo). Checked by the hub on approve and reject (`routes/tasks.ts`).
- **No auth in the demo.** The UI sends the role it's showing. Say so when demoing.

## A task

One task is one request from one role, and it ends proposed (green, waiting for approval), gave up, flagged, or errored. Code: `apps/hub/src/tasks/pipeline.ts` (real) and `mockRunner.ts` (scripted).

| Phase    | Where   | Network             | What                                                                                                                                       |
| -------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| context  | host    | none                | Clone the hub repo's `main` into the task workspace (separate git dir); scan the task text; rank source files; pick linked decisions       |
| baseline | sandbox | registry only       | Install, then typecheck + tests with **no network**; records the starting counts                                                           |
| fix      | sandbox | none                | Propose → role policy → guardrails → apply on host → check. A bug starts with a new failing test. Halts on 3 refusals or a network attempt |
| preview  | sandbox | none (inbound only) | Not wired yet: see [Previews](#previews)                                                                                                   |
| deploy   | host    | GitHub (todo)       | After approval only: `checkPatch` again, `git apply --index` + commit on the hub repo, reload docs                                         |

```
queued → working → proposed → approved → deployed
                 ↘ gave_up    ↘ rejected
                 ↘ flagged → rejected
```

"Green" means no more type errors and failing tests than the baseline, **and** at least one accepted proposal: a task starts green, so the plain stop rule would end it before it did anything (`runTaskLoop` in `packages/agent/src/fixLoop.ts`).

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

| Concern            | How                                                                                                                                                                                                                            | Code                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Untrusted text     | Wrapped and labelled as data in the prompt. `scanTaskInput` flags instruction overrides, secret names, elevated access, URLs, shell commands, encoded blobs. It flags; the rows below are the protection                       | `packages/agent/src/inputScan.ts`  |
| Write scope        | Role policy on every edit, all or nothing; every refusal is a `policy_refused` event; 3 refusals flag the task                                                                                                                 | `policy.ts`, `pipeline.ts`         |
| Edits              | Search/replace on existing files or create new ones. No changes to existing tests, lockfiles, `node_modules`, `.git`; no big deletions; no paths through symlinks; a create never overwrites                                   | `edits.ts`, `safePath.ts`          |
| Process isolation  | One container per command, `--init`, gVisor via `SANDBOX_RUNTIME=runsc` when available                                                                                                                                         | `packages/sandbox/src/args.ts`     |
| Secrets            | Container env built from scratch. No env files, no npmrc, no mounts but `/work`                                                                                                                                                | `buildRunArgs`                     |
| Network            | Install: internal `sandbox` network whose only reachable service is the proxy (GET/HEAD to Verdaccio). Checks and fixes: `--network none`. A test run that tries to connect anyway is reported as `blocked` and halts the task | `apps/egress-proxy`, `pipeline.ts` |
| Resources          | 1 GB, 1 CPU, 256 pids, 120 s per command, read-only root, `--cap-drop ALL`, `no-new-privileges`, non-root uid                                                                                                                  | `args.ts`, `run.ts`                |
| What gets proposed | The diff holds only paths the agent edited through the policy check. Anything else a test run wrote in the worktree (`.hub/` included) never reaches it                                                                        | `diffPaths` in `workspace.ts`      |
| What gets shipped  | Only after approval by the policy's approver. `checkPatch` re-checks every path against the role, and refuses symlinks, binary patches and mode changes. `git apply` runs inside the hub repo                                  | `routes/tasks.ts`, `workspace.ts`  |
| Audit              | Every command, edit, refusal, block, approval and status change is an event on the task's stream                                                                                                                               | `TaskEvent` in `packages/shared`   |

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

| Question     | Answer                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doors        | 443/80 through Caddy (web + `/api`), SSH. The hub, Verdaccio (4873) and the proxy admin port (8081) bind to 127.0.0.1 only. The app is public and unauthenticated: anyone can start tasks and pick any role. Previews, once built, add one public door per task.                |
| Credentials  | `VULTR_INFERENCE_API_KEY` in `/opt/team-workspace/.env` (mode 600, owner `hub`), from the password manager; revoke after the event. A GitHub token only once pushing is built: scoped to the one demo repo, contents write only.                                                |
| Blast radius | A sandbox escape lands as the hub's uid, which is in the `docker` group (root-equivalent), on a box with the inference key and the hub repo. gVisor shrinks the escape odds. A bug in the hub API has the same reach. The VM holds nothing else; throw it away after the event. |
| Abuse        | Public task creation costs tokens and CPU: 5 tasks/min per client, at most 2 running and 10 waiting, 6 iterations per task. Anyone can approve as "dev" without auth: the demo repo is disposable, never point the hub at a real one without adding auth.                       |
| Detection    | systemd journal for the hub, `docker compose logs egress-proxy` for refused requests, the task event streams. Someone watches during the demo.                                                                                                                                  |
| Recovery     | Tasks are in memory. The hub repo is a git repo: reset it to the demo commit. Rebuild = new VM + `deploy/setup-vm.sh` + `docs/deploying.md`.                                                                                                                                    |

## Known gaps

- **No auth.** Roles are picked in the UI. The approval check is real, the identity behind it isn't.
- **Path scopes are coarse.** They limit where code changes, not what it does: a CS edit in `src/checkout/` can still call billing code. The human approval is the gate for behaviour.
- **The input scanner is a heuristic.** It's there to warn the reviewer, not to stop anything.
- **Prod runs approved code** with whatever secrets prod needs. Past approval, the sandbox no longer protects anything.
- **Concurrent approvals:** two tasks touching the same file; the second `git apply` fails and the task errors. No rebase yet.
- **Denied-request attribution is by time window** (from the upgrade agent): with two tasks installing at once, a refused request could show on the wrong task.
