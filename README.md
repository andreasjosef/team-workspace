# Team Workspace

**From customer report to reviewed pull request, without a developer reproducing anything, and without trusting the report.** A support rep forwards a customer's report; an agent reproduces it in a throwaway sandbox, checks it against the team's decisions, and either opens a pull request with the fix or explains why not. The hub never merges: a developer does, in GitHub.

Built for the Vultr Agent Runtime Hackathon. **Direction and build specs: [docs/ticket-to-pr](docs/ticket-to-pr/README.md). Vocabulary: [CONTEXT.md](CONTEXT.md).** The sandbox, egress proxy and agent loop come from `safe-upgrade-agent`.

> **The code is still the first version.** It has three roles (dev, PO, CS), in-hub approval and commits to the hub's own `main`. The specs move it to the direction above; until then, the rest of this README describes the code as it is.

| Path                            | What                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/shared`               | Roles, tasks, the `TaskEvent` stream, workspace data (docs, incidents), API paths: **the contract**                     |
| `packages/agent`                | Role policy enforcement, input scanner, context builder, edit format + guardrails, task loop, prompts, inference client |
| `packages/sandbox`              | `runInSandbox(config, cmd, opts)`: the containment policy, unchanged from the upgrade agent                             |
| `apps/egress-proxy`             | The sandbox network's only way out: GET/HEAD to the local registry, everything else refused and logged                  |
| `apps/hub`                      | Fastify hub: tasks, approvals, role and workspace endpoints, WebSocket stream, mock runner, the real pipeline           |
| `apps/web`                      | Vite + React: one view per role (dev board, PO docs and changes, CS incidents), the task receipt                        |
| `demo/shop`                     | The product the hub works on: a tiny shop with a real bug, decisions, docs and `.hub/` role policies                    |
| `demo/incidents.json`           | Customer reports for the CS view, including the hostile one                                                             |
| `docker-compose.yml`, `deploy/` | Verdaccio + proxy (+ Caddy on the VM), systemd unit, VM setup script                                                    |

## Start (mock runner, no Docker, no LLM)

```sh
pnpm install
cp .env.example .env
pnpm dev            # hub on :3000, web on :5173 (proxies /api, WebSocket included)
```

Open <http://localhost:5173>. The tabs switch role (no auth in the demo; the hub checks the role on every approval).

`RUNNER=mock` plays three scenarios. It's scripted, but the input scanner, the context builder and the role policies are the real ones, so a PO asking for a checkout fix is refused exactly like a real run would be.

| Scenario       | Start it from                              | What happens                                                                                                                                                                             |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discount bug   | CS → INC-1042 → "Ask the agent to fix it"  | Context finds `discount.ts` and decision D-014, a reproduction test goes red, the fix goes green, the dev approves, it deploys                                                           |
| Signup copy    | PO → "Signup button should say Start free" | Context brings D-017, preview link, dev approves                                                                                                                                         |
| Hostile ticket | CS → INC-1043                              | Input flagged; edits to `src/auth/` and `.hub/` refused by the CS policy; an allowed edit that phones home is blocked by the sandbox's missing network; task flagged, can only be closed |

## Run the real pipeline locally

```sh
docker compose up -d                 # verdaccio + egress-proxy (podman compose works too)
pnpm sandbox:image                   # or: podman build -t team-workspace-sandbox:latest packages/sandbox/image
```

The real runner needs the product repo as a git repository, because tasks branch from its `main` and approved patches are committed to it:

```sh
cp -r demo/shop /tmp/shop && git -C /tmp/shop init -q -b main && git -C /tmp/shop add . && git -C /tmp/shop commit -qm init
```

Then in `.env`: `RUNNER=real`, `HUB_REPO_DIR=/tmp/shop`, `VULTR_INFERENCE_API_KEY`, `INFERENCE_MODEL`, `TASKS_DIR=.tasks`, `DEPS_CACHE_DIR=.deps`. With rootless podman on Fedora also set `SANDBOX_DOCKER_BIN=podman`, `SANDBOX_VOLUME_OPTS=rw,z` (lower-case: the dependency cache is shared between sandboxes) and `SANDBOX_EXTRA_ARGS=--userns=keep-id`.

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

Real and tested: the contract; role policies and their enforcement (globs, deny wins, `.hub/` never writable, size caps); the input scanner and untrusted-text wrapping; the context builder (files ranked by keywords, decisions linked to files); edits that create files, with guardrails and symlink-safe paths; the task loop (needs an applied proposal, halts on refusals or a network attempt); approvals checked against the role policy; the hub API with the WebSocket stream and replay; the git plumbing for task branches, touched-paths-only diffs and applying to `main` (tested against a real throwaway repo); the mock runner; the three role views. The demo shop's bug and fix were checked by hand: 5 tests pass, the reproduction test fails, the fix makes all 6 pass.

Carried over unchanged and tested there: the sandbox args and caps, the egress proxy, the install-script scanner.

Real and tested with fakes: the warm dependency cache (one vetted install per lockfile, mounted read-only at `/work/node_modules`). Vitest under the read-only mount was checked with podman.

Not yet run end to end: the real pipeline with a live model and real sandboxes. What's left is in the specs, in build order ([docs/ticket-to-pr](docs/ticket-to-pr/README.md#specs-to-write)):

1. [Real pipeline on the VM](docs/ticket-to-pr/spec-1-real-pipeline-on-vm.md)
2. [Ticket to PR](docs/ticket-to-pr/spec-2-ticket-to-pr.md): a pull request replaces in-hub approval and the commit to `main`
3. Outcomes (not written yet)
4. Containment beat (not written yet)
5. Support view and cleanup (not written yet)

Dropped with the new direction: previews and the PO role. Still open: persistence (tasks are in memory) and the product name.

## Docs

- [Ticket to PR](docs/ticket-to-pr/README.md): the current idea, its definition of done, and the build specs
- [Architecture](docs/architecture.md): trust boundaries, the task lifecycle, role policies, the containment rules and where each lives, known gaps
- [Deploying](docs/deploying.md): the Vultr VM, step by step
- [Demo material](demo/README.md): the shop, the incidents, the demo script
