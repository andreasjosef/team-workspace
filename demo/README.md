# Demo material

| Path | What |
|---|---|
| `shop/` | The product the hub works on. A tiny TypeScript shop with one real bug, three decisions, two docs and the role policies in `.hub/`. See `shop/README.md` |
| `incidents.json` | What the CS view shows: a real bug report (INC-1042), the hostile one (INC-1043), and a how-to question the agent should leave alone |
| `verdaccio/config.yaml` | The local npm mirror the sandbox installs from |

Prettier ignores this folder: the hub parses these files, so they stay as written.

## The bug

`findDiscount` in `shop/src/checkout/discount.ts` looks codes up exactly as typed, but decision D-014 says codes are case-insensitive. Checked by hand: the shop's 5 tests pass, a reproduction test for `summer20` fails, and `input.trim().toUpperCase()` makes all 6 pass. That's the curve the CS demo shows (0 → 1 → 0 failing tests).

## Demo script

The demo script now lives in [docs/ticket-to-pr](../docs/ticket-to-pr/README.md#demo-3-minutes): support only, ending in a pull request. The signup-copy change (D-017) was the PO beat and is no longer part of it.

Reset between runs: restart the hub (tasks are in memory) and, with the real runner, `git reset --hard demo-start` in the hub repo.
