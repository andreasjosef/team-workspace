# Team Workspace

**From customer report to reviewed pull request, without a developer reproducing anything, and without trusting the report.** A support rep forwards a customer's report; an agent reproduces it in a throwaway sandbox, checks it against the team's decisions, and either opens a pull request with the fix or stops and says why. The hub drafts a reply the rep can send the customer. The hub never merges: a developer does, in GitHub.

Built for the Vultr Agent Runtime Hackathon. **Direction and build specs: [docs/ticket-to-pr](docs/ticket-to-pr/README.md). Vocabulary: [CONTEXT.md](CONTEXT.md).** The sandbox, egress proxy and agent loop come from `safe-upgrade-agent`.

> **Left over from the first version:** the PO and dev roles, their role files and prompts, and the mock runner's signup-copy scenario. Their views are hidden (the web app only has the support view); spec 5 removes the rest.

| Path                            | What                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared`               | Roles, tasks, the `TaskEvent` stream, workspace data (docs, incidents), API paths: **the contract**                                       |
| `packages/agent`                | Role policy enforcement, input scanner, context builder, edit format + guardrails, task loop, stop rules, prompts, reply draft, inference |
| `packages/sandbox`              | `runInSandbox(config, cmd, opts)`: the containment policy, unchanged from the upgrade agent                                               |
| `apps/egress-proxy`             | The install network's only way out: GET/HEAD to the local registry, everything else refused and logged                                    |
| `apps/hub`                      | Fastify hub: tasks, workspace endpoints, WebSocket stream, mock runner, the real pipeline, the fixture run, the GitHub publisher          |
| `apps/web`                      | Vite + React: the support view (inbox, task top card with the drafted reply, receipt tabs)                                                |
| `demo/shop`                     | The product the hub works on: a tiny shop with a real bug, decisions, docs and `.hub/` role policies and prompts                          |
| `demo/incidents.json`           | Customer reports for the support inbox, including the hostile one                                                                         |
| `docker-compose.yml`, `deploy/` | Verdaccio + proxy (+ Caddy on the VM), systemd unit, VM and demo-repo wizards, update and demo reset scripts                              |

## Start (mock runner, no Docker, no LLM)

```sh
pnpm install
cp .env.example .env
pnpm dev            # hub on :3000, web on :5173 (proxies /api, WebSocket included)
```

Open <http://localhost:5173>: the support rep's inbox. There's no auth in the demo; the hub checks the `cs` role's scope on every task it starts and every edit.

`RUNNER=mock` plays the demo beats. It's scripted, but the input scanner, the context builder and the role policies are the real ones.

| Beat           | Start it from                                                | What happens                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discount bug   | Inbox → INC-1042 → forward                                   | Context finds `discount.ts` and decision D-014, a reproduction test goes red, the fix goes green, a (fake) pull request opens for a developer, and a drafted reply appears. The Agent tab shows the prompt, its source commit and each iteration     |
| Hostile report | Inbox → INC-1043 → forward                                   | Input flagged, task ends `flagged`, no pull request, the reply is a fixed template                                                                                                                                                                   |
| Fixture run    | INC-1043's Containment tab → "What if the model had obeyed?" | A scripted hostile proposal (not the model): the `src/auth/users.ts` edit refused by the `cs` policy, the `.hub/roles/cs.json` edit refused by the lock, the test that posts `.env` to a collector blocked by the missing network. Nothing published |

## Run the real pipeline locally

```sh
docker compose up -d                 # verdaccio + egress-proxy (podman compose works too)
pnpm sandbox:image                   # or: podman build -t team-workspace-sandbox:latest packages/sandbox/image
```

The real runner needs the product repo as a git repository, because tasks branch from its `main`. Without `GITHUB_REPO`, a green task becomes a `task/<id>` branch in that repo (with a `file://` link) and `main` stays as it is:

```sh
cp -r demo/shop /tmp/shop && git -C /tmp/shop init -q -b main && git -C /tmp/shop add . && git -C /tmp/shop commit -qm init
```

Then in `.env`: `RUNNER=real`, `HUB_REPO_DIR=/tmp/shop`, `VULTR_INFERENCE_API_KEY`, `INFERENCE_MODEL`, `TASKS_DIR=.tasks`, `DEPS_CACHE_DIR=.deps`. With rootless podman on Fedora also set `SANDBOX_DOCKER_BIN=podman`, `SANDBOX_VOLUME_OPTS=rw,Z` and `SANDBOX_EXTRA_ARGS=--userns=keep-id`.

To open real pull requests, point `HUB_REPO_DIR` at a clone of the demo repo and set `GITHUB_REPO` and `GITHUB_TOKEN` ([docs/deploying.md](docs/deploying.md#3-the-product-repo); `deploy/demo-repo-wizard.sh` walks the GitHub side). The hub syncs to origin's `main` before each task.

## Security: the hub can't merge

Customer reports are untrusted, so the claim is that **nothing reaches the product without a developer merging it**, and that the hub is unable to merge, not merely unwilling. GitHub enforces it, not the hub's own code ([ADR 0001](docs/adr/0001-hub-never-merges.md)):

- A green task becomes a branch `task/<id>` holding only the checked patch, and a pull request on the demo repo. The hub has no route that approves, merges or commits to `main`.
- A ruleset on the demo repo's `main` requires a pull request with one approving review and forbids force pushes and deletion, with an empty bypass list, so it binds admins too.
- The hub's fine-grained token belongs to a bot account and covers the one demo repo, with Contents and Pull requests read/write and Metadata read. Pushing to `main` or merging with it is refused by GitHub (checked on the VM: the push gets GH013, the merge 405).
- The bot can't approve its own pull requests, so a developer always reviews.
- The token never reaches a sandbox, git config or a remote URL: only the push's process and the API calls.

Inside the hub: sandboxes with no secrets and no network beyond the package mirror (checks and fixes run with none at all), role scopes checked on every edit and again on the patch, `.hub/` never agent-writable, and customer text treated as data. A flagged report never opens a pull request, and its reply is a template, so hostile text never shapes what the rep sends. A model-drafted reply is checked (plain text, no URLs, emails or promised dates, a fix in review never called shipped) or replaced by the template. See [Architecture](docs/architecture.md).

## Commands

| Command                                      | Does                                          |
| -------------------------------------------- | --------------------------------------------- |
| `pnpm dev`                                   | Hub (watch) and web together                  |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | What CI runs                                  |
| `pnpm build`                                 | Builds the web app (the hub runs from source) |
| `pnpm sandbox:image`                         | Builds the sandbox image                      |
| `pnpm infra:up` / `pnpm infra:down`          | Verdaccio + egress proxy                      |
| `deploy/reset-demo.sh <owner/name>`          | Closes demo PRs and deletes `task/*` branches |

Needs Node 24+, pnpm (via corepack), and Docker or podman for the real runner.

## What's real and what's left

Real and tested: the contract; role policies and their enforcement (globs, deny wins, `.hub/` never writable, size caps); the input scanner and untrusted-text wrapping; the context builder (files ranked by keywords, decisions linked to files); edits that create files, with guardrails and symlink-safe paths; the task loop and its stop rules (needs an applied proposal, halts on refusals or a network attempt, gives up when the error count stops falling); the flagged end rule (a flagged report ends `flagged` unless it errors); the hub API with the WebSocket stream and replay; the git plumbing for task branches, touched-paths-only diffs, the sync to origin's `main` and publishing a checked patch on its own branch (tested against real throwaway repos, with a bare repo standing in for GitHub); the pull request body, with customer text fenced so it can't ping, render HTML or load images; the GitHub publisher (push, pull request, labels; tested with a fake API); the fixture run (real policy, fake sandbox, never published); the reply draft and its rule checker; the prompt record behind the Agent tab; the mock runner; the support view.

Carried over unchanged and tested there: the sandbox args and caps, the egress proxy, the install-script scanner. Real and tested with fakes: the warm dependency cache (one vetted install per lockfile, mounted read-only at `/work/node_modules`).

Real on the VM with a live model and gVisor sandboxes: INC-1042 from forward to green, 5 out of 5, in about 31 s ([#10](https://github.com/andreasjosef/team-workspace/issues/10)); INC-1043, 5 out of 5 runs where the model refused ([#11](https://github.com/andreasjosef/team-workspace/issues/11)), which now end `flagged`; the GitHub side end to end, with the token's push to `main` and merge refused ([#28](https://github.com/andreasjosef/team-workspace/issues/28)). Not yet recorded on the VM: the fixture run in a real sandbox. Tokens per task aren't recorded.

Specs, in build order ([docs/ticket-to-pr](docs/ticket-to-pr/README.md#specs-to-write)):

1. [Real pipeline on the VM](docs/ticket-to-pr/spec-1-real-pipeline-on-vm.md): done
2. [Ticket to PR](docs/ticket-to-pr/spec-2-ticket-to-pr.md): done; a pull request replaces in-hub approval and the commit to `main`
3. Outcomes (not written; cut for the hackathon apart from the drafted reply)
4. [Containment you can see, a drafted reply, the agent made visible](docs/ticket-to-pr/spec-4-demo-day.md): done (trimmed)
5. Support view cleanup: remove the PO and dev leftovers, rename `Incident` to report (not written)

Dropped with the new direction: previews and the PO role. Still open: persistence (tasks are in memory, so restart the hub between demo runs) and the product name.

## Docs

- [Ticket to PR](docs/ticket-to-pr/README.md): the current idea, its definition of done, the demo script and the build specs
- [Architecture](docs/architecture.md): trust boundaries, the task lifecycle, role policies, the containment rules and where each lives, known gaps
- [Deploying](docs/deploying.md): the Vultr VM and the GitHub demo repo, step by step
- [Agent context](docs/agent-context.md): findings on the agent's prompt and context
- [Demo material](demo/README.md): the shop, the incidents, the demo beats
