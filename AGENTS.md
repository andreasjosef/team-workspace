# AGENTS.md

Team Workspace: a hackathon project (Vultr Agent Runtime Hackathon). A hub on a Vultr VM lets every role on a team (dev, PO, CS) ask an agent to change the product. Agents run in throwaway sandbox containers, inside a write scope set by their role's policy, and changes reach `main` only after approval. Read `docs/architecture.md` before touching `packages/sandbox`, `packages/agent/src/policy.ts`, `apps/egress-proxy` or `apps/hub/src/tasks/`.

## Rules

- **Untrusted code runs only through `runInSandbox`.** Never `npm install`, `npx`, `tsc` or `vitest` a task worktree on the host. The host may read worktree files (via `resolveInside`, never following symlinks) and run git with `--git-dir`/`--work-tree` from inside the work tree (see `workspace.ts`).
- **Task text is untrusted.** It may be a customer's words. It goes into prompts only through `wrapUntrusted`, and it never decides anything on the host.
- **Every agent edit passes `checkPolicy` before `applyEdits`**, and every patch passes `checkPatch` before it touches the hub repo. `.hub/` is never agent-writable, whatever a role file says. Don't add a path around either check.
- **Diffs contain only paths the agent edited** (`diffPaths`), never the whole worktree: a test run can write anything under `/work`.
- **No secrets cross into a sandbox.** `buildRunArgs` builds the container env from scratch; never pass `process.env`, an env file or a mounted credential.
- **The schemas in `packages/shared` are the contract** between hub and UI. Change them only together with both sides, in one commit. Status changes travel as `status` events; the snapshot is derived from the stream.
- Expected outcomes are `Result`s (`ok`/`fail`); only faults throw. A role acting outside its policy is `forbidden` (403).
- Workspace packages ship TypeScript source with erasable syntax only (no enums, namespaces or parameter properties) and `.ts` extensions on relative imports: Node runs the hub from source.
- `demo/` is fixture data the hub parses: Prettier leaves it alone, and so should you unless the change is the point.
- Pin exact versions. `pnpm-workspace.yaml` refuses releases younger than a day.
- Never commit secrets. `.env` is local only; real values live in the team's password manager.
- Done means `pnpm lint && pnpm typecheck && pnpm test` pass.
