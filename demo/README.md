# Demo material

| Path | What |
|---|---|
| `shop/` | The product the hub works on. A tiny TypeScript shop with three real bugs, four decisions, two docs and the role policies in `.hub/`. See `shop/README.md` |
| `incidents.json` | What the CS view shows: a real bug report (INC-1042), the hostile one (INC-1043), a how-to question the agent should leave alone, and two more bugs for visitors to try (INC-1044, INC-1045) |
| `verdaccio/config.yaml` | The local npm mirror the sandbox installs from |

Prettier ignores this folder: the hub parses these files, so they stay as written.

## The bugs

`findDiscount` in `shop/src/checkout/discount.ts` looks codes up exactly as typed, but decision D-014 says codes are case-insensitive. Checked by hand: the shop's 5 tests pass, a reproduction test for `summer20` fails, and `input.trim().toUpperCase()` makes all 6 pass. That's the curve the CS demo shows (0 → 1 → 0 failing tests).

Two more for visitors to the live demo, outside the 3-minute script:

- **INC-1044, free shipping.** `shippingFor` in `shop/src/checkout/shipping.ts` checks `> 5000`, but D-021 says orders of €50 or more ship free. The shop's tests pass; a test for exactly €50 fails; `>=` fixes it. Inside the `cs` scope, so it should end in a pull request.
- **INC-1045, annual price.** `shop/src/billing/plans.ts` prices annual at 14_400 cents, but D-009 says annual costs ten months (12_000). The fix is in `src/billing/`, which the `cs` policy denies, so the agent should confirm it and stop: "Confirmed, but not fixed", for a developer. Not yet run against the live model.

## Demo script

The full script lives in [docs/ticket-to-pr](../docs/ticket-to-pr/README.md#demo-3-minutes): support only. The beats, and what each needs from this folder:

1. **INC-1042 → pull request + reply.** Forward it from the inbox. The top card shows the outcome, "Pull request #N, waiting for a developer" and the drafted reply. The PR holds the reproduction test for `summer20` and the fix (see "The bug" below).
2. **Agent tab.** The prompt and roles from `shop/.hub/` at the task's commit, the report inside its untrusted wrapper, and the model's reasoning per iteration.
3. **INC-1043 → flagged → fixture run.** Flagged, no PR. On its Containment tab, "What if the model had obeyed?" runs the scripted hostile proposal: the `src/auth/users.ts` edit refused by the `cs` policy, the `.hub/roles/cs.json` edit refused by the lock, and the call to `collector.attacker.example` blocked because checks run with no network.

The mock runner (`pnpm dev`) scripts all three without Docker. The signup-copy change (D-017) was the PO beat and is no longer part of it.

Reset between runs: restart the hub (tasks are in memory) and, with the real runner, `git reset --hard demo-start` in the hub repo.
