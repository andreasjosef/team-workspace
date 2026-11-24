# Team Workspace

**Everyone on a startup team can change the product, through agents that can't hurt it.** A CS rep turns a customer report into a reproduced, fixed bug; a PO changes copy and gets a preview; a dev reviews and ships. Each role's agent works in a throwaway sandbox, inside a write scope set by the role's policy, and nothing reaches `main` without the right person's approval.

Built for the Vultr Agent Runtime Hackathon. Idea and architecture notes: `vultur-hackton/team-workspace-idea.md` and `team-workspace-architecture.md` in the vault. The sandbox, egress proxy and agent loop come from `safe-upgrade-agent`.

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

Then in `.env`: `RUNNER=real`, `HUB_REPO_DIR=/tmp/shop`, `VULTR_INFERENCE_API_KEY`, `INFERENCE_MODEL`, `TASKS_DIR=.tasks`. With rootless podman on Fedora also set `SANDBOX_DOCKER_BIN=podman`, `SANDBOX_VOLUME_OPTS=rw,Z` and `SANDBOX_EXTRA_ARGS=--userns=keep-id`.

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

Not yet run end to end: the real pipeline with a live model and real sandboxes. Before the event, in order:

- [ ] Vultr: VM, `deploy/setup-vm.sh`, does gVisor work ([deploying](docs/deploying.md))
- [ ] Pick `INFERENCE_MODEL` and run the discount scenario with `RUNNER=real` (Agent + Hub)
- [ ] Tune the role prompts in `demo/shop/.hub/prompts/` until the hostile ticket is refused by the model too, not only by the policy
- [ ] Previews: start a container per task from its worktree and route `<id>.preview.<domain>` to it through Caddy (`pipeline.ts` TODO, see [architecture](docs/architecture.md#previews))
- [ ] Deploy after approval: push `main` to GitHub, restart the prod container (`pipeline.ts` TODO)
- [ ] Persistence: tasks are in memory; a restart forgets them
- [ ] Product name ("Team Workspace" for now)

## Docs

- [Ticket to PR](docs/ticket-to-pr/README.md): the current idea, its definition of done, and the build specs
- [Architecture](docs/architecture.md): trust boundaries, the task lifecycle, role policies, the containment rules and where each lives, known gaps
- [Deploying](docs/deploying.md): the Vultr VM, step by step
- [Demo material](demo/README.md): the shop, the incidents, the demo script
