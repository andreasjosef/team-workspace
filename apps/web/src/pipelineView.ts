import {
  isFinalStatus,
  type EventEnvelope,
  type IterationSummary,
  type TaskSnapshot,
} from '@app/shared';
import { reproduced } from './taskView.ts';

export type StageId = 'scan' | 'sandbox' | 'agent' | 'verify' | 'output';

export type StageState =
  'pending' | 'active' | 'done' | 'warn' | 'blocked' | 'stopped';

export type ConnectorState =
  'idle' | 'flowing' | 'done' | 'blocked' | 'stopped';

export type PipelineStage = {
  id: StageId;
  label: string;
  detail: string;
  badge: string | null;
  state: StageState;
};

export type IterationPill = {
  n: number;
  label: string;
  tone: 'green' | 'gold' | 'red' | 'muted';
};

export type PipelineModel = {
  stages: PipelineStage[];
  connectors: ConnectorState[];
  live: boolean;
  mood: 'running' | 'done' | 'flagged' | 'stopped' | 'error';
  headline: string;
  ticker: string;
  tickerTone: 'default' | 'gold' | 'green' | 'red' | 'blue';
  iterations: IterationPill[];
  eventCount: number;
  commandCount: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
  lastEventAtMs: number | null;
};

// Applies a slice of WebSocket events onto a task's base identity so both live
// streaming and Replay mode reflect the exact state at that point in time.
export const snapshotFromEvents = (
  base: TaskSnapshot,
  events: EventEnvelope[],
  { replace = false }: { replace?: boolean } = {}
): TaskSnapshot => {
  if (!events.length && !replace) return base;
  const iterations: IterationSummary[] = [];
  const refusals: { path: string; rule: string }[] = [];
  const blocked: string[] = [];
  let status = replace ? ('queued' as TaskSnapshot['status']) : base.status;
  let statusReason = replace ? null : base.statusReason;
  let phase = replace ? null : base.phase;
  let baseSha = replace ? null : base.baseSha;
  let context = replace
    ? {
        files: [] as string[],
        decisions: [] as { id: string; title: string }[],
      }
    : base.context;
  let inputSignals = replace ? ([] as string[]) : base.inputSignals;
  let previewUrl = replace ? null : base.previewUrl;
  let pr = replace ? null : base.pr;
  let prompt = replace ? null : base.prompt;
  let replyDraft = replace ? null : base.replyDraft;
  let fixtureRun = replace ? null : base.fixtureRun;
  let updatedAt = base.createdAt;
  let hasDiff = replace ? false : base.hasDiff;

  for (const env of events) {
    updatedAt = env.at;
    const e = env.event;
    switch (e.type) {
      case 'status':
        status = e.status;
        statusReason = e.reason ?? null;
        break;
      case 'phase':
        phase = e.phase;
        break;
      case 'base':
        baseSha = e.sha;
        break;
      case 'context':
        context = { files: e.files, decisions: e.decisions };
        break;
      case 'prompt':
        prompt = { sections: e.sections, repo: e.repo };
        break;
      case 'input_flagged':
        inputSignals = e.signals;
        break;
      case 'policy_refused':
        refusals.push({ path: e.path, rule: e.rule });
        break;
      case 'blocked':
        blocked.push(`${e.kind}: ${e.detail}`);
        break;
      case 'iteration': {
        const { type: _type, ...it } = e;
        iterations.push(it);
        if (it.n > 0 && it.proposed?.length && !it.refused?.length)
          hasDiff = true;
        break;
      }
      case 'preview':
        previewUrl = e.url;
        break;
      case 'pr':
        pr = { url: e.url, number: e.number, draft: e.draft };
        hasDiff = true;
        break;
      case 'reply_draft':
        replyDraft = { text: e.text, source: e.source };
        break;
      case 'fixture_run':
        fixtureRun = e.taskId;
        break;
    }
  }

  const baseFinal = !replace && isFinalStatus(base.status);
  const mergedStatus =
    baseFinal && !isFinalStatus(status) ? base.status : status;
  const mergedReason =
    baseFinal && !isFinalStatus(status) ? base.statusReason : statusReason;

  return {
    ...base,
    updatedAt,
    status: mergedStatus,
    statusReason: mergedReason,
    phase: phase ?? (replace ? null : base.phase),
    baseSha: baseSha ?? (replace ? null : base.baseSha),
    context:
      context.files.length || context.decisions.length || replace
        ? context
        : base.context,
    inputSignals:
      inputSignals.length || replace ? inputSignals : base.inputSignals,
    iterations:
      replace || iterations.length >= base.iterations.length
        ? iterations
        : base.iterations,
    refusals:
      replace || refusals.length >= base.refusals.length
        ? refusals
        : base.refusals,
    blocked:
      replace || blocked.length >= base.blocked.length ? blocked : base.blocked,
    previewUrl: previewUrl ?? (replace ? null : base.previewUrl),
    pr: pr ?? (replace ? null : base.pr),
    prompt: prompt ?? (replace ? null : base.prompt),
    replyDraft: replyDraft ?? (replace ? null : base.replyDraft),
    fixtureRun: fixtureRun ?? (replace ? null : base.fixtureRun),
    hasDiff: hasDiff || (!replace && base.hasDiff),
  };
};

const shortCmd = (cmd: string) => {
  const cleaned = cmd.replace(/^npx --no-install\s+/, '');
  return cleaned.length > 26 ? `${cleaned.slice(0, 25)}…` : cleaned;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const describeLastEvent = (
  events: EventEnvelope[],
  task: TaskSnapshot
): { text: string; tone: PipelineModel['tickerTone'] } => {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!.event;
    switch (e.type) {
      case 'pr':
        return {
          text: `Opened pull request #${e.number} for developer review`,
          tone: 'green',
        };
      case 'reply_draft':
        return {
          text:
            task.status === 'pr_opened'
              ? 'Customer reply drafted — ready to copy'
              : task.status === 'flagged'
                ? 'Containment held — safe template reply ready'
                : 'Customer reply drafted',
          tone: task.status === 'flagged' ? 'red' : 'green',
        };
      case 'blocked':
        return {
          text: `Sandbox blocked ${e.kind}: ${e.detail}`,
          tone: 'red',
        };
      case 'policy_refused':
        return {
          text: `Policy refused edit to ${e.path} (${e.rule})`,
          tone: 'red',
        };
      case 'input_flagged':
        return {
          text: `Input scanner flagged report: ${e.signals.join(', ')}`,
          tone: 'red',
        };
      case 'iteration':
        if (e.n === 0)
          return {
            text: `Baseline check: ${e.typeErrors} type errors, ${e.testsFailed} failing tests`,
            tone: e.testsFailed || e.typeErrors ? 'gold' : 'green',
          };
        if (e.refused?.length)
          return {
            text: `Iteration ${e.n}: refused ${e.refused.map((r) => r.path).join(', ')}`,
            tone: 'red',
          };
        return {
          text:
            e.testsFailed > 0
              ? `Iteration ${e.n}: reproduced (${plural(e.testsFailed, 'failing test')})`
              : `Iteration ${e.n}: checks pass (0 errors, 0 failures)`,
          tone: e.testsFailed > 0 ? 'gold' : 'green',
        };
      case 'command':
        return {
          text: `$ ${e.cmd} · exit ${e.exitCode} · ${(e.durationMs / 1000).toFixed(1)}s`,
          tone: e.exitCode === 0 ? 'blue' : 'gold',
        };
      case 'context': {
        const parts = [
          e.files.length ? plural(e.files.length, 'file') : null,
          e.decisions.length ? plural(e.decisions.length, 'decision') : null,
        ].filter(Boolean);
        return {
          text: parts.length
            ? `Context built: ${parts.join(', ')}`
            : 'Context built',
          tone: 'blue',
        };
      }
      case 'prompt':
        return {
          text: `Prompt assembled (${plural(e.sections.length, 'section')}) — waiting for model`,
          tone: 'blue',
        };
      case 'phase':
        return { text: `Entered ${e.phase} phase`, tone: 'blue' };
      case 'log':
        return { text: e.message, tone: 'default' };
      case 'status':
        return {
          text: e.reason ? `${e.status}: ${e.reason}` : `Status → ${e.status}`,
          tone:
            e.status === 'flagged' || e.status === 'error'
              ? 'red'
              : e.status === 'pr_opened'
                ? 'green'
                : 'blue',
        };
      default:
        break;
    }
  }
  return {
    text:
      task.status === 'queued'
        ? 'Queued — waiting for sandbox runner…'
        : 'Streaming task events…',
    tone: 'blue',
  };
};

export const derivePipeline = (
  task: TaskSnapshot,
  events: EventEnvelope[],
  diffText = ''
): PipelineModel => {
  const live = task.status === 'queued' || task.status === 'working';
  const final = isFinalStatus(task.status);
  const phasesSeen = new Set<string>();
  const commands: { cmd: string; exitCode: number }[] = [];
  for (const env of events) {
    if (env.event.type === 'phase') phasesSeen.add(env.event.phase);
    if (env.event.type === 'command')
      commands.push({ cmd: env.event.cmd, exitCode: env.event.exitCode });
  }
  if (task.phase) phasesSeen.add(task.phase);

  const [baseline, ...fixIters] = task.iterations;
  const hasContext =
    task.context.files.length > 0 ||
    task.context.decisions.length > 0 ||
    task.baseSha !== null ||
    phasesSeen.has('baseline') ||
    phasesSeen.has('fix') ||
    phasesSeen.has('publish') ||
    final;
  const hasBaseline =
    baseline !== undefined ||
    phasesSeen.has('fix') ||
    phasesSeen.has('publish');
  const didFixPhase =
    phasesSeen.has('fix') || task.prompt !== null || fixIters.length > 0;
  const didPublishPhase =
    phasesSeen.has('preview') ||
    phasesSeen.has('publish') ||
    task.pr !== null ||
    task.status === 'pr_opened';

  const hasSignals = task.inputSignals.length > 0;
  const hasRefusals = task.refusals.length > 0;
  const hasBlocked = task.blocked.length > 0;
  const repro = reproduced(task);
  const lastFixIter = fixIters[fixIters.length - 1];
  const greenFix =
    lastFixIter !== undefined &&
    !lastFixIter.refused?.length &&
    lastFixIter.typeErrors === 0 &&
    lastFixIter.testsFailed === 0 &&
    !hasBlocked;

  let diffFiles = 0;
  let diffAdds = 0;
  let diffDels = 0;
  if (diffText) {
    for (const line of diffText.split('\n')) {
      if (line.startsWith('diff --git ')) diffFiles++;
      else if (line.startsWith('+') && !line.startsWith('+++')) diffAdds++;
      else if (line.startsWith('-') && !line.startsWith('---')) diffDels++;
    }
  }

  // 1. Scan / Containment (maps to Containment tab)
  let scanState: StageState = 'pending';
  let scanDetail = 'Waiting';
  let scanBadge: string | null = null;
  if (hasSignals) {
    scanState = task.phase === 'context' && live ? 'active' : 'blocked';
    scanDetail = `${plural(task.inputSignals.length, 'signal')} flagged`;
    scanBadge = 'Flagged';
  } else if (task.phase === 'context' && live && !hasBaseline) {
    scanState = 'active';
    scanDetail = hasContext ? 'Input clean' : 'Scanning report…';
    scanBadge = '4 layers';
  } else if (hasContext) {
    scanState = 'done';
    scanDetail = 'Clean · contained';
    scanBadge = '0 blocks';
  } else if (task.status === 'queued') {
    scanState = 'active';
    scanDetail = 'Queued…';
  }

  // 2. Sandbox / Log (maps to Log tab)
  let sandboxState: StageState = 'pending';
  let sandboxDetail = 'Isolated container';
  let sandboxBadge: string | null = null;
  const lastCmd = commands[commands.length - 1];
  if (task.phase === 'baseline' && live && !hasBaseline) {
    sandboxState = 'active';
    sandboxDetail = lastCmd ? shortCmd(lastCmd.cmd) : 'Starting sandbox…';
  } else if (hasBaseline) {
    sandboxState =
      baseline && (baseline.typeErrors > 0 || baseline.testsFailed > 0)
        ? 'warn'
        : 'done';
    sandboxDetail = baseline
      ? baseline.typeErrors === 0 && baseline.testsFailed === 0
        ? 'Baseline green'
        : `${baseline.typeErrors} err · ${baseline.testsFailed} fail`
      : 'Ready';
    if (commands.length > 0) sandboxBadge = plural(commands.length, 'cmd');
  } else if (final) {
    sandboxState = 'stopped';
    sandboxDetail = 'Not reached';
  }

  // 3. Agent (maps to Agent tab)
  let agentState: StageState = 'pending';
  let agentDetail = 'Role-scoped edits';
  let agentBadge: string | null = null;
  const ctxBadge =
    task.context.decisions[0]?.id ??
    (task.context.files.length
      ? plural(task.context.files.length, 'file')
      : null);
  const ctxSummary = [
    task.context.files.length
      ? plural(task.context.files.length, 'file')
      : null,
    task.context.decisions[0]?.id ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (task.phase === 'fix' && live && !didPublishPhase) {
    agentState = hasRefusals ? 'blocked' : 'active';
    if (hasRefusals) {
      agentDetail = `${plural(task.refusals.length, 'edit')} refused`;
      agentBadge = `Iter ${fixIters.length || 1}`;
    } else if (repro) {
      agentDetail = 'Writing fix…';
      agentBadge = `Iter ${fixIters.length + 1}`;
    } else if (task.prompt) {
      agentDetail = 'Reproducing bug…';
      agentBadge = `Iter ${fixIters.length + 1}`;
    } else {
      agentDetail = ctxSummary || 'Building prompt…';
    }
  } else if (hasRefusals) {
    agentState = 'blocked';
    agentDetail = `${plural(task.refusals.length, 'edit')} refused`;
    agentBadge = 'Policy';
  } else if (
    didFixPhase &&
    (greenFix || didPublishPhase || fixIters.length > 0)
  ) {
    agentState =
      task.status === 'gave_up'
        ? 'stopped'
        : task.status === 'flagged'
          ? 'warn'
          : 'done';
    agentDetail =
      fixIters.length > 0
        ? `${plural(fixIters.length, 'iteration')}`
        : ctxSummary || 'Completed';
    if (ctxBadge) agentBadge = ctxBadge;
  } else if (final) {
    agentState = 'stopped';
    agentDetail = task.status === 'gave_up' ? 'Skipped' : 'Not reached';
  } else if (ctxSummary) {
    agentDetail = ctxSummary;
  }

  // 4. Checks & Network Guard (maps to Checks tab)
  let verifyState: StageState = 'pending';
  let verifyDetail = 'No-network check';
  let verifyBadge: string | null = null;
  if (hasBlocked) {
    verifyState = 'blocked';
    verifyDetail = 'Network blocked';
    verifyBadge = 'Contained';
  } else if (task.phase === 'fix' && live && fixIters.length > 0) {
    if (greenFix) {
      verifyState = 'done';
      verifyDetail = repro ? 'Repro → 0 fail' : '0 err · 0 fail';
      verifyBadge = 'Green';
    } else if (repro) {
      verifyState = 'warn';
      verifyDetail = `Repro · ${plural(lastFixIter!.testsFailed, 'fail')}`;
      verifyBadge = 'Repro';
    } else {
      verifyState = 'active';
      verifyDetail = 'Running checks…';
    }
  } else if (greenFix || task.status === 'pr_opened') {
    verifyState = 'done';
    verifyDetail = repro ? 'Repro → 0 fail' : '0 err · 0 fail';
    verifyBadge = 'Green';
  } else if (task.status === 'flagged' && hasRefusals) {
    verifyState = 'blocked';
    verifyDetail = 'Halted by policy';
  } else if (task.status === 'gave_up') {
    verifyState = 'stopped';
    verifyDetail = repro ? 'Confirmed only' : 'Unconfirmed';
  } else if (task.status === 'error') {
    verifyState = 'blocked';
    verifyDetail = 'Check failed';
  }

  // 5. Changes / Pull Request
  let outputLabel = 'Changes';
  let outputState: StageState = 'pending';
  let outputDetail = 'Patch & PR';
  let outputBadge: string | null = null;

  if (task.status === 'pr_opened' && task.pr) {
    outputLabel = `PR #${task.pr.number}`;
    outputState = 'done';
    outputDetail =
      diffFiles > 0
        ? `${plural(diffFiles, 'file')} · +${diffAdds} -${diffDels}`
        : 'Ready for review';
    outputBadge = 'In review';
  } else if ((task.phase === 'preview' || task.phase === 'publish') && live) {
    outputLabel = 'Pull Request';
    outputState = 'active';
    outputDetail = task.phase === 'preview' ? 'Checking patch…' : 'Opening PR…';
  } else if (task.status === 'flagged') {
    outputLabel = 'Blocked';
    outputState = 'blocked';
    outputDetail = 'Nothing published';
    outputBadge = 'Safe';
  } else if (task.status === 'gave_up') {
    outputLabel = 'Escalated';
    outputState = 'stopped';
    outputDetail = 'Needs developer';
  } else if (task.status === 'error') {
    outputLabel = 'Stopped';
    outputState = 'blocked';
    outputDetail = 'Task failed';
  }

  const stages: PipelineStage[] = [
    {
      id: 'scan',
      label: 'Scan',
      detail: scanDetail,
      badge: scanBadge,
      state: scanState,
    },
    {
      id: 'sandbox',
      label: 'Sandbox',
      detail: sandboxDetail,
      badge: sandboxBadge,
      state: sandboxState,
    },
    {
      id: 'agent',
      label: 'Agent',
      detail: agentDetail,
      badge: agentBadge,
      state: agentState,
    },
    {
      id: 'verify',
      label: 'Checks',
      detail: verifyDetail,
      badge: verifyBadge,
      state: verifyState,
    },
    {
      id: 'output',
      label: outputLabel,
      detail: outputDetail,
      badge: outputBadge,
      state: outputState,
    },
  ];

  const connectorBetween = (
    left: PipelineStage,
    right: PipelineStage
  ): ConnectorState => {
    if (right.state === 'blocked') return 'blocked';
    if (left.state === 'blocked' && right.state === 'pending') return 'blocked';
    if (right.state === 'active') return 'flowing';
    if (
      left.state === 'active' &&
      (right.state === 'pending' || right.state === 'warn')
    )
      return 'flowing';
    if (left.state === 'done' && right.state === 'warn') return 'flowing';
    if (left.state === 'done' && right.state === 'done') return 'done';
    if (left.state === 'warn' && right.state === 'done') return 'done';
    if (left.state === 'blocked' && right.state === 'done') return 'done';
    if (right.state === 'stopped' || left.state === 'stopped') return 'stopped';
    return 'idle';
  };

  const connectors: ConnectorState[] = [
    connectorBetween(stages[0]!, stages[1]!),
    connectorBetween(stages[1]!, stages[2]!),
    connectorBetween(stages[2]!, stages[3]!),
    connectorBetween(stages[3]!, stages[4]!),
  ];

  const iterations: IterationPill[] = task.iterations.map((it) => {
    if (it.n === 0)
      return {
        n: 0,
        label:
          it.typeErrors === 0 && it.testsFailed === 0
            ? 'Base ✓'
            : `Base ${it.testsFailed}✕`,
        tone: it.typeErrors === 0 && it.testsFailed === 0 ? 'green' : 'gold',
      };
    if (it.refused?.length)
      return { n: it.n, label: `#${it.n} refused`, tone: 'red' };
    if (it.testsFailed > 0)
      return { n: it.n, label: `#${it.n} repro`, tone: 'gold' };
    if (it.typeErrors === 0 && it.testsFailed === 0)
      return {
        n: it.n,
        label:
          hasBlocked && it.n === lastFixIter?.n
            ? `#${it.n} blocked`
            : `#${it.n} pass`,
        tone: hasBlocked && it.n === lastFixIter?.n ? 'red' : 'green',
      };
    return { n: it.n, label: `#${it.n}`, tone: 'muted' };
  });

  const mood: PipelineModel['mood'] = live
    ? 'running'
    : task.status === 'pr_opened'
      ? 'done'
      : task.status === 'flagged'
        ? 'flagged'
        : task.status === 'error'
          ? 'error'
          : 'stopped';

  const headline = live
    ? 'Pipeline running'
    : task.status === 'pr_opened'
      ? 'Pipeline complete'
      : task.status === 'flagged'
        ? 'Contained before publish'
        : task.status === 'error'
          ? 'Pipeline failed'
          : 'Pipeline stopped';

  const ticker = describeLastEvent(events, task);
  const firstAt = events[0]?.at ?? task.createdAt;
  const lastAt = events[events.length - 1]?.at ?? task.updatedAt;
  const startedAtMs = Number.isFinite(Date.parse(firstAt))
    ? Date.parse(firstAt)
    : null;
  const lastEventAtMs = Number.isFinite(Date.parse(lastAt))
    ? Date.parse(lastAt)
    : null;
  const endedAtMs = !live ? lastEventAtMs : null;

  return {
    stages,
    connectors,
    live,
    mood,
    headline,
    ticker: ticker.text,
    tickerTone: ticker.tone,
    iterations,
    eventCount: events.length,
    commandCount: commands.length,
    startedAtMs,
    endedAtMs,
    lastEventAtMs,
  };
};

// Groups raw events into visible animation beats for Replay mode so the user
// sees each meaningful step smoothly instead of jittering through burst logs.
export const buildReplayCutoffs = (events: EventEnvelope[]): number[] => {
  if (events.length === 0) return [];
  const beats = new Set<string>([
    'phase',
    'input_flagged',
    'context',
    'command',
    'prompt',
    'policy_refused',
    'blocked',
    'iteration',
    'pr',
    'status',
    'reply_draft',
  ]);
  const cutoffs: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const type = events[i]!.event.type;
    if (beats.has(type)) cutoffs.push(i + 1);
  }
  if (cutoffs[cutoffs.length - 1] !== events.length)
    cutoffs.push(events.length);
  return cutoffs;
};
