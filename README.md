# Team Workspace

**From customer report to reviewed pull request, without a developer reproducing anything, and without trusting the report.** A support rep forwards a customer's report; an agent reproduces it in a throwaway sandbox, checks it against the team's decisions, and either opens a pull request with the fix or explains why not. The hub never merges: a developer does, in GitHub.

Built for the Vultr Agent Runtime Hackathon. **Direction and build specs: [docs/ticket-to-pr](docs/ticket-to-pr/README.md). Vocabulary: [CONTEXT.md](CONTEXT.md).** The sandbox, egress proxy and agent loop come from `safe-upgrade-agent`.

> **Left over from the first version:** the PO and dev roles and their views. The support rep is the product; spec 5 removes the rest.

| Path                            | What                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/shared`               | Roles, tasks, the `TaskEvent` stream, workspace data (docs, incidents), API paths: **the contract**                     |
| `packages/agent`                | Role policy enforcement, input scanner, context builder, edit format + guardrails, task loop, prompts, inference client |
| `packages/sandbox`              | `runInSandbox(config, cmd, opts)`: the containment policy, unchanged from the upgrade agent                             |
| `apps/egress-proxy`             | The sandbox network's only way out: GET/HEAD to the local registry, everything else refused and logged                  |
| `apps/hub`                      | Fastify hub: tasks, role and workspace endpoints, WebSocket stream, mock runner, the real pipeline, the publisher       |
| `apps/web`                      | Vite + React: one view per role (dev board, PO docs and changes, CS incidents), the task receipt                        |
| `demo/shop`                     | The product the hub works on: a tiny shop with a real bug, decisions, docs and `.hub/` role policies                    |
| `demo/incidents.json`           | Customer reports for the CS view, including the hostile one                                                             |
| `docker-compose.yml`, `deploy/` | Verdaccio + proxy (+ Caddy on the VM), systemd unit, VM setup and demo reset scripts                                    |

## Start (mock runner, no Docker, no LLM)

```sh
pnpm install
cp .env.example .env
pnpm dev            # hub on :3000, web on :5173 (proxies /api, WebSocket included)
```

Open <http://localhost:5173>. The tabs switch role (no auth in the demo; the hub checks each role's scope on every task it starts).

`RUNNER=mock` plays three scenarios. It's scripted, but the input scanner, the context builder and the role policies are the real ones, so a PO asking for a checkout fix is refused exactly like a real run would be.

| Scenario       | Start it from                              | What happens                                                                                                                                                                             |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discount bug   | CS → INC-1042 → "Ask the agent to fix it"  | Context finds `discount.ts` and decision D-014, a reproduction test goes red, the fix goes green, a (fake) pull request opens for a developer                                            |
| Signup copy    | PO → "Signup button should say Start free" | Context brings D-017, preview link, a (fake) pull request                                                                                                                                |
| Hostile ticket | CS → INC-1043                              | Input flagged; edits to `src/auth/` and `.hub/` refused by the CS policy; an allowed edit that phones home is blocked by the sandbox's missing network; task flagged, can only be closed |

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

## Security: the hub can't merge

Customer reports are untrusted, so the claim is that **nothing reaches the product without a developer merging it**, and that the hub is unable to merge, not merely unwilling. GitHub enforces it, not the hub's own code ([ADR 0001](docs/adr/0001-hub-never-merges.md)):

- A green task becomes a branch `task/<id>` holding only the checked patch, and a pull request on the demo repo. The hub has no route that approves, merges or commits to `main`.
- A ruleset on the demo repo's `main` requires a pull request with one approving review and forbids force pushes and deletion, with an empty bypass list, so it binds admins too.
- The hub's fine-grained token covers the one demo repo, with Contents and Pull requests read/write and Metadata read. Pushing to `main` or merging with it is refused by GitHub; the setup checklist tries both ([docs/deploying.md](docs/deploying.md#3-the-product-repo)).
- The hub opens its pull requests as the token's owner, who can't approve their own, so a developer always reviews.
- The token never reaches a sandbox, git config or a remote URL: only the push's process and the API calls.

Inside the hub: sandboxes with no secrets and no network beyond the package mirror, role scopes checked on every edit and again on the patch, and customer text treated as data. See [Architecture](docs/architecture.md).

## Commands

| Command                                      | Does                                          |
| -------------------------------------------- | --------------------------------------------- |
| `pnpm dev`                                   | Hub (watch) and web together                  |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | What CI runs                                  |
| `pnpm build`                                 | Builds the web app (the hub runs from source) |
| `pnpm sandbox:image`                         | Builds the sandbox image                      |
| `pnpm infra:up` / `pnpm infra:down`          | Verdaccio + egress proxy                      |

Needs Node 24+, pnpm (via corepack), and Docker or podman for the real runner.

## What's real and what's left

Real and tested: the contract; role policies and their enforcement (globs, deny wins, `.hub/` never writable, size caps); the input scanner and untrusted-text wrapping; the context builder (files ranked by keywords, decisions linked to files); edits that create files, with guardrails and symlink-safe paths; the task loop (needs an applied proposal, halts on refusals or a network attempt); the hub API with the WebSocket stream and replay; the git plumbing for task branches, touched-paths-only diffs, the sync to origin's `main` and publishing a checked patch on its own branch (tested against real throwaway repos, with a bare repo standing in for GitHub); the pull request body, with customer text fenced so it can't ping, render HTML or load images; the GitHub publisher (push, pull request, labels; tested with a fake API); the mock runner; the three role views. The demo shop's bug and fix were checked by hand: 5 tests pass, the reproduction test fails, the fix makes all 6 pass.

Carried over unchanged and tested there: the sandbox args and caps, the egress proxy, the install-script scanner.

Real and tested with fakes: the warm dependency cache (one vetted install per lockfile, mounted read-only at `/work/node_modules`). Vitest under the read-only mount was checked with podman.

Real on the VM with a live model and gVisor sandboxes: INC-1042 from forward to green (spec 1, before pull requests), 5 out of 5, in about 31 s (three sandbox boots of about 9 s each; [run records on #10](https://github.com/andreasjosef/team-workspace/issues/10)). Not yet recorded live: INC-1043 (#11). Tokens per task aren't recorded yet. What's left is in the specs, in build order ([docs/ticket-to-pr](docs/ticket-to-pr/README.md#specs-to-write)):

1. [Real pipeline on the VM](docs/ticket-to-pr/spec-1-real-pipeline-on-vm.md)
2. [Ticket to PR](docs/ticket-to-pr/spec-2-ticket-to-pr.md): a pull request replaces in-hub approval and the commit to `main`
3. Outcomes (not written yet)
4. Containment beat (not written yet)
5. Support view and cleanup (not written yet)

Dropped with the new direction: previews and the PO role. Still open: persistence (tasks are in memory) and the product name.

## Docs

- [Ticket to PR](docs/ticket-to-pr/README.md): the current idea, its definition of done, and the build specs
- [Architecture](docs/architecture.md): trust boundaries, the task lifecycle, role policies, the containment rules and where each lives, known gaps
- [Deploying](docs/deploying.md): the Vultr VM and the GitHub demo repo, step by step
- [Demo material](demo/README.md): the shop, the incidents, the demo script
