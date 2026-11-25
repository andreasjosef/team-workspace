import type { TaskSnapshot, TaskStatus } from '@app/shared';
import { progress, statusLook, type Tone } from '../taskView.ts';

export const Dot = ({ tone }: { tone: Tone }) => (
  <span className={`dot tone-${tone}`}>●</span>
);

export const Status = ({ status }: { status: TaskStatus }) => {
  const look = statusLook[status];
  return (
    <span className={`tone-${look.tone}`}>
      <Dot tone={look.tone} />
      {look.label}
    </span>
  );
};

// Report → reproduced → fixed → review, as a row of steps.
export const Progress = ({ task }: { task: TaskSnapshot }) => (
  <ol className="progress" aria-label="Progress">
    {progress(task).map((s) => (
      <li key={s.label} className={`step step-${s.state}`}>
        <span className="step-mark" aria-hidden="true">
          {s.state === 'done' ? '✓' : s.state === 'stopped' ? '✕' : '●'}
        </span>
        {s.label}
      </li>
    ))}
  </ol>
);
