# The hub never merges: a pull request is the only way a change leaves it

The first version of the hub had developers approve a task inside the hub, which then committed the patch to the product repo's `main` itself. We replaced that with a branch and a GitHub pull request that only a developer can merge, and GitHub's branch rules (not the hub's own code) refuse any merge or push to `main` by the hub's token. Reports come from customers and are untrusted, so the claim the product rests on is "nothing reaches the product without a developer merging it"; that claim only holds if the hub is unable to merge, not merely unwilling, and developers already review in GitHub.

## Considered Options

- **In-hub approval, hub commits to `main`** (the first version): one less system, but the hub then holds the power to change `main`, approval identity needs real accounts in the hub, and any hub bug or compromise reaches the product directly.
- **Pull request, merged by a developer in GitHub** (chosen): the hub can only add branches and open pull requests; review happens where developers already work.

## Consequences

- The hub follows GitHub's `main` (it fetches before each task) instead of being its own source of truth.
- Approval screens, approve/reject routes and the approver identity disappear from the hub.
- The guarantee depends on the GitHub repo's settings: branch rules on `main` with no bypass, and a token that can't merge. They are part of the deployment, and must be checked on setup.
