import type { EventEnvelope, TaskSnapshot } from '@app/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  buildReplayCutoffs,
  derivePipeline,
  snapshotFromEvents,
  type PipelineModel,
} from '../pipelineView.ts';
import { useDiff } from '../queries.ts';

const REPLAY_BEAT_MS = 620;

// The pipeline card's model for one task, plus Replay: steps back through
// the event stream beat by beat. `viewTask` is the task as of the beat
// being shown (the live task when not replaying), so whatever renders
// under the card replays along with it.
export const usePipeline = (
  task: TaskSnapshot,
  events: EventEnvelope[]
): {
  model: PipelineModel;
  viewTask: TaskSnapshot;
  replaying: boolean;
  canReplay: boolean;
  replay: () => void;
  stop: () => void;
} => {
  const [step, setStep] = useState<number | null>(null);
  const cutoffs = useMemo(() => buildReplayCutoffs(events), [events]);
  const replaying = step !== null && cutoffs.length > 0;

  useEffect(() => {
    if (step === null || cutoffs.length === 0) return;
    if (step >= cutoffs.length - 1) {
      const done = setTimeout(() => setStep(null), 900);
      return () => clearTimeout(done);
    }
    const next = setTimeout(
      () => setStep((s) => (s === null ? null : s + 1)),
      REPLAY_BEAT_MS
    );
    return () => clearTimeout(next);
  }, [step, cutoffs.length]);

  const visible = useMemo(
    () =>
      replaying
        ? events.slice(0, cutoffs[Math.min(step, cutoffs.length - 1)]!)
        : events,
    [replaying, step, cutoffs, events]
  );
  const viewTask = useMemo(
    () => snapshotFromEvents(task, visible, { replace: replaying }),
    [task, visible, replaying]
  );
  const diff = useDiff(task.id, viewTask.hasDiff, task.status);
  const diffText = viewTask.hasDiff ? (diff.data ?? '') : '';
  const model = useMemo(
    () => derivePipeline(viewTask, visible, diffText),
    [viewTask, visible, diffText]
  );

  return {
    model,
    viewTask,
    replaying,
    canReplay: !model.live && cutoffs.length > 1,
    replay: () => setStep(0),
    stop: () => setStep(null),
  };
};
