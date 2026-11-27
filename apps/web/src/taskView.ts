import type {
  EventEnvelope,
  Role,
  TaskSnapshot,
  TaskStatus,
} from '@app/shared';

// Pure helpers behind the views: what each status looks like, and the task
// in plain words. Kept out of the components so they're testable.

export type Tone = 'gold' | 'green' | 'red' | 'blue' | 'muted';

export const statusLook: Record<TaskStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'blue' },
  working: { label: 'Agent working', tone: 'blue' },
  proposed: { label: 'Checks pass', tone: 'gold' },
  pr_opened: { label: 'In review', tone: 'gold' },
  gave_up: { label: 'Gave up', tone: 'muted' },
  flagged: { label: 'Flagged', tone: 'red' },
  error: { label: 'Error', tone: 'red' },
};

// Did a check fail more tests than the baseline? That's the reproduction.
export const reproduced = (t: TaskSnapshot) => {
  const [baseline, ...rest] = t.iterations;
  return (
    baseline !== undefined &&
    rest.some((i) => i.testsFailed > baseline.testsFailed)
  );
};

// The task in words a support rep can act on: what happened, what's next,
// and what they can tell the customer (null when they shouldn't say anything).
export type Outcome = {
  headline: string;
  detail: string;
  customer: string | null;
  tone: Tone;
};

const workingDetail = (t: TaskSnapshot) => {
  if (t.phase === 'context')
    return "Reading the code and the team's decisions that apply.";
  if (t.phase === 'baseline') return 'Running the tests as they are now.';
  return reproduced(t)
    ? 'The problem is reproduced. Writing the fix.'
    : 'Reproducing the problem with a new test.';
};

export const outcome = (t: TaskSnapshot): Outcome => {
  // A fixture run always ends flagged; it reports on the layers, not a fix.
  if (t.fixtureOf !== null && t.status === 'flagged')
    return {
      headline: 'Fixture: a scripted hostile proposal, not the model',
      detail:
        'The hub replayed what the flagged report asked for through the real policy and sandbox. Nothing was published.',
      customer: null,
      tone: 'red',
    };
  switch (t.status) {
    case 'queued':
      return {
        headline: 'Waiting to start',
        detail: 'The agent picks this up in a moment.',
        customer: null,
        tone: 'blue',
      };
    case 'working':
      return {
        headline: 'The agent is on it',
        detail: workingDetail(t),
        customer: null,
        tone: 'blue',
      };
    case 'proposed':
      return {
        headline: 'A fix passes the tests',
        detail:
          'The agent reproduced the problem with a test, then fixed it. Opening a pull request for a developer.',
        customer: null,
        tone: 'gold',
      };
    case 'pr_opened':
      return {
        headline: 'A fix is ready for review',
        detail:
          'The agent reproduced the problem with a test, then fixed it. A developer reviews the pull request before it ships.',
        customer: "We've confirmed the problem, and a fix is in review.",
        tone: 'gold',
      };
    case 'flagged':
      return {
        headline: 'Stopped: the report tried to steer the agent',
        detail:
          'The report carried instructions, so nothing was proposed. The developers can see what it tried.',
        customer: null,
        tone: 'red',
      };
    case 'gave_up':
      return reproduced(t)
        ? {
            headline: 'Confirmed, but not fixed',
            detail:
              'The agent reproduced the problem but found no fix within its limits. A developer needs to look.',
            customer:
              "We've confirmed the problem and passed it to our developers.",
            tone: 'muted',
          }
        : {
            headline: "The agent couldn't confirm this",
            detail:
              'It stopped without reproducing the problem. A developer needs to look.',
            customer: null,
            tone: 'muted',
          };
    case 'error':
      return {
        headline: 'Something went wrong on our side',
        detail: 'The task failed before it finished. Try forwarding it again.',
        customer: null,
        tone: 'red',
      };
  }
};

// The four steps from report to reviewed fix, for the progress strip.
export type StepState = 'done' | 'current' | 'todo' | 'stopped';
export type Step = { label: string; state: StepState };

export const progress = (t: TaskSnapshot): Step[] => {
  const live = t.status === 'queued' || t.status === 'working';
  const fixed = t.status === 'proposed' || t.status === 'pr_opened';
  const ended = !live && !fixed;
  const repro = reproduced(t) || fixed;
  const step = (label: string, done: boolean, current: boolean): Step => ({
    label,
    state: done ? 'done' : current ? 'current' : 'todo',
  });
  const steps = [
    step('Report received', true, false),
    step('Problem reproduced', repro, live),
    step('Fix passes the tests', fixed, live && repro),
    // The review happens on the pull request; the hub doesn't follow it
    // after it opens, so this step stays current.
    step('Developer review', false, t.status === 'pr_opened'),
  ];
  // Where an ended task stopped: the first step it didn't finish.
  if (ended) {
    const at = steps.findIndex((s) => s.state !== 'done');
    if (at > 0) steps[at] = { ...steps[at]!, state: 'stopped' };
  }
  return steps;
};

export const createdBy = (tasks: TaskSnapshot[], role: Role) =>
  tasks.filter((t) => t.input.role === role);

export const taskForIncident = (tasks: TaskSnapshot[], incidentId: string) =>
  tasks.find((t) => t.input.incidentId === incidentId);

export const timeAgo = (iso: string, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

// Who wrote the reply draft, in the rep's words.
export const replyDraftLabel = (d: { source: 'model' | 'template' }) =>
  d.source === 'model' ? 'Drafted by the model' : 'Drafted from a template';

// Containment, layer by layer: the input scanner, the role policy, the
// `.hub/` lock and the network. `taskLayers` reads one task's own events;
// `fixtureLayers` puts the flagged report's scanner next to its fixture run,
// which tried each of the other layers in turn.
//
// Checks and fixes run with `--network none`: a call out of the sandbox has
// no route, so the sandbox reports it `blocked`. The egress proxy only
// governs installs, so it isn't the layer that stops it.
export type LayerState =
  'flagged' | 'not fired' | 'refused' | 'blocked' | 'not reached' | 'waiting';
export type Layer = { name: string; state: LayerState; detail: string | null };

export const NETWORK_LAYER = 'Network: no way out of the sandbox';

const isHubPath = (path: string) => path === '.hub' || path.startsWith('.hub/');

export const taskLayers = (task: TaskSnapshot): Layer[] =>
  layers(task, task, 'not fired');

export const fixtureLayers = (
  flagged: TaskSnapshot,
  fixture: TaskSnapshot | null
): Layer[] => {
  const ended =
    fixture !== null &&
    fixture.status !== 'queued' &&
    fixture.status !== 'working';
  return layers(flagged, fixture, ended ? 'not reached' : 'waiting');
};

// `scanned` is the task whose report the scanner read; `tried` the one whose
// edits and runs met the other layers. `idle` is a layer that didn't fire.
const layers = (
  scanned: TaskSnapshot,
  tried: TaskSnapshot | null,
  idle: LayerState
): Layer[] => {
  const refusal = (hub: boolean) =>
    tried?.refusals.find((r) => isHubPath(r.path) === hub);
  const policy = refusal(false);
  const lock = refusal(true);
  const blocked = tried?.blocked.find((b) => b.startsWith('network: '));
  return [
    {
      name: 'Input scanner',
      state: scanned.inputSignals.length ? 'flagged' : 'not fired',
      detail: scanned.inputSignals.join(', ') || null,
    },
    {
      name: 'Role policy',
      state: policy ? 'refused' : idle,
      detail: policy ? `${policy.path} (${policy.rule})` : null,
    },
    {
      name: '.hub/ lock',
      state: lock ? 'refused' : idle,
      detail: lock ? `${lock.path} (${lock.rule})` : null,
    },
    {
      name: NETWORK_LAYER,
      state: blocked ? 'blocked' : idle,
      detail: blocked ? blocked.slice('network: '.length) : null,
    },
  ];
};

// The Run tab: each check as one step, with what happened in a word. The
// verdicts follow the fix loop's rules (packages/agent/src/fixLoop.ts): a
// bug is reproduced (more tests fail than at the baseline) before it's
// fixed, and an answer that was rejected or refused leaves the counts as
// they were. Read from the snapshot only, never from the model's words.
export type StepVerdict =
  | 'baseline'
  | 'reproduced'
  | 'green'
  | 'better'
  | 'worse'
  | 'no change'
  | 'rejected'
  | 'refused';

export type RunStep = {
  n: number;
  typeErrors: number;
  testsFailed: number;
  verdict: StepVerdict;
  tone: Tone;
};

const verdictTone: Record<StepVerdict, Tone> = {
  baseline: 'muted',
  reproduced: 'gold',
  green: 'green',
  better: 'blue',
  worse: 'red',
  'no change': 'muted',
  rejected: 'muted',
  refused: 'red',
};

export const runSteps = (t: TaskSnapshot): RunStep[] => {
  const [baseline] = t.iterations;
  let repro = false;
  return t.iterations.map((it, k) => {
    const prev = t.iterations[k - 1];
    const verdict: StepVerdict = ((): StepVerdict => {
      if (k === 0 || !baseline || !prev) return 'baseline';
      if (it.refused?.length) return 'refused';
      if (it.rejected) return 'rejected';
      if (!repro && it.testsFailed > baseline.testsFailed) {
        repro = true;
        return 'reproduced';
      }
      if (it.testsFailed === 0 && it.typeErrors === 0) return 'green';
      const before = prev.testsFailed + prev.typeErrors;
      const after = it.testsFailed + it.typeErrors;
      return after < before ? 'better' : after > before ? 'worse' : 'no change';
    })();
    return {
      n: it.n,
      typeErrors: it.typeErrors,
      testsFailed: it.testsFailed,
      verdict,
      tone: verdictTone[verdict],
    };
  });
};

// The conversation's timeline: the milestones of a task's event stream, in
// the rep's words. Only what changes the story makes it in; the rest is on
// the Agent view. Decided on event types and counts, never on model text.
export type ThreadEvent = { seq: number; at: string; text: string; tone: Tone };

export const threadEvents = (events: EventEnvelope[]): ThreadEvent[] => {
  const out: ThreadEvent[] = [];
  const add = (e: EventEnvelope, text: string, tone: Tone) =>
    out.push({ seq: e.seq, at: e.at, text, tone });
  let baseline: number | null = null;
  let repro = false;
  let green = false;
  // After anything was stopped, passing checks aren't good news on their
  // own, so they read neutral.
  let stopped = false;
  for (const env of events) {
    const e = env.event;
    if (out.length === 0) add(env, 'Forwarded to the agent', 'muted');
    switch (e.type) {
      case 'input_flagged':
        stopped = true;
        add(env, 'The report looks like it carries instructions', 'red');
        break;
      case 'iteration':
        if (baseline === null) baseline = e.testsFailed;
        else if (!repro && e.testsFailed > baseline) {
          repro = true;
          add(
            env,
            `Problem reproduced with a failing test (step ${e.n})`,
            'gold'
          );
        } else if (
          !green &&
          e.testsFailed === 0 &&
          e.typeErrors === 0 &&
          !e.rejected &&
          !e.refused?.length &&
          (repro || e.proposed?.length)
        ) {
          green = true;
          if (stopped) add(env, `Checks pass (step ${e.n})`, 'muted');
          else add(env, `Fix passes the tests (step ${e.n})`, 'green');
        }
        break;
      case 'policy_refused':
        stopped = true;
        add(env, `Edit to ${e.path} refused by the role policy`, 'red');
        break;
      case 'blocked':
        stopped = true;
        add(env, `Blocked by the sandbox: ${e.detail}`, 'red');
        break;
      case 'pr':
        add(env, `Pull request #${e.number} opened`, 'gold');
        break;
      case 'status':
        if (
          e.status === 'gave_up' ||
          e.status === 'flagged' ||
          e.status === 'error'
        )
          add(
            env,
            `Stopped${e.reason ? `: ${e.reason}` : ''}`,
            e.status === 'gave_up' ? 'muted' : 'red'
          );
        break;
    }
  }
  return out;
};

// The live box: the hub's stages for one task, which is under way, and the
// latest thing it did there. `preview` folds into the last stage.
export type StageState = 'done' | 'current' | 'todo' | 'stopped';
export type Stage = {
  id: 'context' | 'baseline' | 'fix' | 'publish';
  label: string;
  state: StageState;
  startedAt: string | null;
  endedAt: string | null;
  latest: string | null;
};

const STAGES: { id: Stage['id']; label: string }[] = [
  { id: 'context', label: 'Reading the code and the decisions that apply' },
  { id: 'baseline', label: 'Running the tests as they are' },
  { id: 'fix', label: 'Reproducing the problem, then fixing it' },
  { id: 'publish', label: 'Opening a pull request' },
];

export const liveStages = (events: EventEnvelope[], live: boolean): Stage[] => {
  const stages: Stage[] = STAGES.map((s) => ({
    ...s,
    state: 'todo',
    startedAt: null,
    endedAt: null,
    latest: null,
  }));
  let at = -1;
  for (const { at: time, event: e } of events) {
    if (e.type === 'phase') {
      const next = STAGES.findIndex(
        (s) => s.id === (e.phase === 'preview' ? 'publish' : e.phase)
      );
      if (next > at) {
        for (let k = Math.max(0, at); k < next; k++)
          stages[k] = { ...stages[k]!, state: 'done', endedAt: time };
        at = next;
        stages[at] = { ...stages[at]!, state: 'current', startedAt: time };
      }
      continue;
    }
    if (at < 0) continue;
    const latest =
      e.type === 'command'
        ? `$ ${e.cmd} · exit ${e.exitCode} · ${(e.durationMs / 1000).toFixed(1)}s`
        : e.type === 'iteration'
          ? e.n === 0
            ? `Baseline: ${e.testsFailed} failing tests, ${e.typeErrors} type errors`
            : `Step ${e.n}: ${e.testsFailed} failing tests, ${e.typeErrors} type errors`
          : e.type === 'policy_refused'
            ? `Refused: ${e.path}`
            : null;
    if (latest) stages[at] = { ...stages[at]!, latest };
  }
  // Once the run is over, the stage it was in either finished or is where
  // it stopped.
  if (!live && at >= 0) {
    const last = events[events.length - 1];
    const ended = [...events]
      .reverse()
      .find((e) => e.event.type === 'status')?.event;
    const ok = ended?.type === 'status' && ended.status === 'pr_opened';
    stages[at] = {
      ...stages[at]!,
      state: ok ? 'done' : 'stopped',
      endedAt: last?.at ?? null,
    };
  }
  return stages;
};

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const elapsed = (fromIso: string, toMs: number) => {
  const s = Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
