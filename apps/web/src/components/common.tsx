import type { TaskStatus } from '@app/shared';
import { statusLook, type Tone } from '../taskView.ts';

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
