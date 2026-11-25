# Ticket to PR

A support rep forwards a customer's report; an agent reproduces it in a sandbox, checks it against the team's decisions, and either fixes it in a pull request or explains why not. Nothing reaches the product without a developer merging it.

## Language

### People

**Customer**:
The person who wrote a report. Their words are untrusted.
_Avoid_: User, client

**Support rep**:
The person who forwards reports and tells the customer the outcome. Never approves or merges anything.
_Avoid_: CS agent, CS rep, CSM, support agent

**Developer**:
The person who reviews and merges pull requests, in GitHub.
_Avoid_: Approver, reviewer (as a role name)

**Agent**:
The AI that works on a task. Only ever the AI, never a person.
_Avoid_: Bot, assistant

### Work

**Report**:
A customer's message describing a problem, verbatim. A report can be forwarded more than once.
_Avoid_: Ticket, incident, issue

**Forward**:
A support rep handing a report to the agent. Each forward starts a new task.
_Avoid_: Submit, escalate, file

**Task**:
One attempt by the agent at one report. A task ends in exactly one outcome.
_Avoid_: Job, mission, run

**Reproduction**:
A new test that fails because of the reported problem.
_Avoid_: Repro, failing test

**Fix**:
A change inside the scope that makes the reproduction pass without breaking other tests.
_Avoid_: Patch, solution

**Scope**:
The paths a role's agent may change, in two parts: where it may add tests (wide) and where it may change code (narrow). Everything outside is refused before it's written.
_Avoid_: Permissions, write access

**Decision**:
A short record in the product repo of what the team decided, why, and who decided, linked to the files it affects.
_Avoid_: ADR, rule, policy

### Outcomes

**Outcome**:
How a task ended, in words a support rep can pass on. One of: fixed, reproduced, explained, not reproduced, flagged. When more than one fits, the first in this order wins: flagged, explained, fixed, reproduced, not reproduced.
_Avoid_: Result, status, resolution

**Fixed**:
A reproduction and a fix exist; a pull request is open for a developer.

**Reproduced**:
A reproduction exists but no fix within the scope, for example because the cause is in code the agent may not change. A draft pull request holds the reproduction for a developer.
_Avoid_: Confirmed, escalated

**Explained**:
The reported behaviour is what a decision asks for, so it's intended. When the code breaks a decision instead, that's a fix, not an explanation. No pull request.
_Avoid_: Works as intended, by design, won't fix

**Not reproduced**:
No reproduction and no decision covers it. The support rep can't tell the customer it's a bug or that it's intended. No pull request.
_Avoid_: Works as intended, can't reproduce

**Flagged**:
The report tried to steer the agent, and the task was stopped. Wins over every other outcome, even a working fix. No pull request.
_Avoid_: Blocked, rejected, hostile

### The system

**Hub**:
The trusted service that holds the secrets, runs tasks, and opens pull requests. It never merges.
_Avoid_: Server, orchestrator, backend

**Sandbox**:
A throwaway container where all untrusted code for a task runs, with no secrets and no network.
_Avoid_: Container, VM, environment

**Pull request**:
The only way a change leaves the hub. Opened by the hub, merged only by a developer.
_Avoid_: Deploy, merge, approval

**Receipt**:
The account of a task: what the agent saw, what it tried, and what was refused or blocked. It becomes the pull request's description.
_Avoid_: Log, report, summary
