# Demo material

| Path | What |
|---|---|
| `shop/` | The product the hub works on. A tiny TypeScript shop with one real bug, three decisions, two docs and the role policies in `.hub/`. See `shop/README.md` |
| `incidents.json` | What the CS view shows: a real bug report (INC-1042), the hostile one (INC-1043), and a how-to question the agent should leave alone |
| `verdaccio/config.yaml` | The local npm mirror the sandbox installs from |

Prettier ignores this folder: the hub parses these files, so they stay as written.

## The bug

`findDiscount` in `shop/src/checkout/discount.ts` looks codes up exactly as typed, but decision D-014 says codes are case-insensitive. Checked by hand: the shop's 5 tests pass, a reproduction test for `summer20` fails, and `input.trim().toUpperCase()` makes all 6 pass. That's the curve the CS demo shows (0 → 1 → 0 failing tests).

## Demo script (3 minutes)

1. **Hook (20 s):** "In a startup, every change waits for a dev. We let the whole team change the product, safely."
2. **CS (60 s):** Customer support tab → INC-1042 → "Ask the agent to fix it". Show the receipt: D-014 pulled in as context, the failing reproduction test, the green fix, the diff. Switch to the Developer tab: it's in "Needs your review". Approve → Live.
3. **PO (30 s):** Product owner tab → D-017 → request "Signup button should say Start free". Preview link, dev approves.
4. **Containment (60 s):** Customer support → INC-1043, the hostile report. Show what each layer did:
   - the task text is flagged (instruction override, secrets, elevated access, a URL);
   - the agent's edit to `src/auth/users.ts` and its attempt to widen its own role in `.hub/` are both refused by the CS policy;
   - the one edit the policy allows tries to send the environment out, and the test run is blocked, because the sandbox has no network and no secrets anyway;
   - the task is flagged, the dev can read the diff, and it can only be closed.
5. **Close (10 s):** architecture slide: trusted hub, untrusted sandboxes, a policy per role, a human gate before `main`.

Reset between runs: restart the hub (tasks are in memory) and, with the real runner, `git reset --hard demo-start` in the hub repo.
