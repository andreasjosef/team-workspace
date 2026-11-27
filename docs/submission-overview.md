# Sandbugs

## The Problem

Customer bug reports start as untrusted prose. Today, support reps file hand-written tickets, developers spend time reproducing bugs before writing a line of code, and everyone waits. AI coding agents could automate reproduction and fixes—but giving an agent write access driven by raw customer text opens the door to prompt injection, secret exfiltration, and unauthorized code changes.

## What Sandbugs Does

**Sandbugs** turns a customer report into a verified GitHub pull request—without a developer reproducing anything, and without ever trusting the report.

> **The LLM proposes, the sandbox decides, a developer merges.**

### End-to-End Flow

1. **Support Cockpit (Conversation & Agent Views):** A support rep reads incoming customer reports in the inbox and clicks **Forward**. A real-time WebSocket stream powers two views:
   - **Conversation:** The customer thread (explicitly labelled untrusted), quiet run milestones, live pipeline progress, plain-language outcome, PR link, and an editable customer reply draft.
   - **Agent:** Interactive stage-by-stage pipeline (with **Replay**), syntax-highlighted **Changes** diff view, **Run** tab (full prompt sections, source `.hub/` commit link, model iterations, token usage), **Containment** tab, and live **Log**.
2. **Fresh Sync & Grounded Context:** Before every task, the hub fetches `main` from the product repo, reloads `.hub/` role policies and `decisions/` docs, clones an isolated task workspace (`--separate-git-dir` kept outside the container mount), ranks relevant source files by keyword, attaches linked product decisions, and wraps customer text in `<untrusted>` delimiters (`wrapUntrusted`).
3. **Early Flagging for Hostile Reports:** A heuristic scanner inspects both the title and body for prompt-injection overrides, secret names, elevated-access requests, URLs, shell commands, and encoded blobs. Flagged reports stop **immediately after the context phase**—no dependency install, no sandbox spin-up, no model call, no PR—and use a fixed safe reply template.
4. **Hardened Two-Step Loop (Reproduce → Fix) in Throwaway Sandboxes:**
   - **Baseline:** Runs `tsc` and `vitest` inside an isolated gVisor sandbox with `--network none`. Dependencies are cached by `package-lock.json` SHA-256 hash: on a cache miss, `npm ci` runs on an internal Docker network routed solely through our allowlisted egress proxy to a local Verdaccio mirror, vetted against the proxy's denied log and an install-script scanner before being mounted read-only at `/work/node_modules`.
   - **Reproduce step (loop-enforced):** The agent may _only_ create new test files. The reproduction is accepted only if `tsc` errors do not increase, more tests fail than baseline, and Vitest actually executed and failed a real test (rejecting syntax/loader crashes)—otherwise the created files are deleted and rejected.
   - **Fix step (loop-enforced):** The agent edits code strictly within the role's allowed paths (excluding the reproduction test) until typechecks and tests return green, or explicitly exits via `action: "stop"` with a reason. Rejected pre-sandbox proposals never pollute the check curve, and both sandbox checks and total model calls are strictly capped.
5. **Defense-in-Depth Containment & Live "What if the model had obeyed?" Proof:**
   - **Role Policies:** Every edit passes `checkPolicy` before touching disk (deny-over-allow globs, max changed lines, and `.hub/**` hardcoded unwritable so a report can never talk an agent into widening its own scope).
   - **Host & Patch Guardrails:** No edits to existing tests or lockfiles, symlink-safe path resolution, diffs built strictly from policy-approved edited paths (`diffPaths`), and `checkPatch` re-verification (blocking symlinks, binary diffs, and mode changes) before `git apply`.
   - **Throwaway Sandboxes:** One fresh container per command (`--runtime=runsc`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`, non-root user, 1 CPU, 1 GB RAM, 256 pids, 120s timeout, clean env with zero secrets).
   - **Interactive Fixture Run:** On any flagged report, click **"What if the model had obeyed?"** in the Containment tab to replay a scripted hostile proposal (adding an admin in `src/auth/users.ts`, widening `.hub/`, and exfiltrating `.env`) through the real policy engine and sandbox—proving live that every defense layer stops it independently and nothing is published.
6. **GitHub PR Only (The Hub Never Merges) & Validated Reply Draft:**
   - Only green tasks push a `task/<id>` branch (token scoped to one repo, passed solely via `GIT_ASKPASS` to that single push process) and open a GitHub PR with the full audit receipt (all customer and model text fenced to neutralize markdown/HTML/`@mention` injection).
   - A GitHub branch ruleset on `main` (1 required approving review, empty bypass list) paired with a separate bot account ensures the hub is technically unable to push to `main` or merge—a human developer always reviews and merges in GitHub.
   - After completion, the hub drafts a customer reply validated by `checkReplyDraft` (plain text, ≤1,200 chars, no URLs, emails, or promised dates, and never describing an unmerged PR as shipped), falling back to a safe template if any rule fails.
