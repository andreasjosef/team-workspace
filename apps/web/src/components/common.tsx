import type { Role, RoleSummary, TaskSnapshot, TaskStatus } from '@app/shared';
import { Link } from 'react-router';
import { statusLook, timeAgo, type Tone } from '../taskView.ts';

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

export const TaskList = ({
  tasks,
  role,
  empty,
}: {
  tasks: TaskSnapshot[];
  role: Role;
  empty: string;
}) =>
  tasks.length === 0 ? (
    <p className="empty">{empty}</p>
  ) : (
    <ul className="list">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link className="item" to={`/${role}/tasks/${t.id}`}>
            <span className="item-title">{t.input.title}</span>
            <span className="item-meta">
              <Status status={t.status} /> · {t.input.role} {t.input.kind} ·{' '}
              {timeAgo(t.updatedAt)}
              {t.inputSignals.length + t.refusals.length + t.blocked.length >
                0 && (
                <span className="tone-red">
                  {' '}
                  · {t.refusals.length + t.blocked.length} blocked
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

// What this role's agent may touch, straight from its policy file.
export const RoleScope = ({ role }: { role: RoleSummary | undefined }) =>
  role ? (
    <div className="panel small">
      <h2>{role.label}: agent scope</h2>
      <p className="muted">{role.description}</p>
      <dl className="kv">
        <dt>Can write</dt>
        <dd>
          {role.write.allow.map((g) => (
            <span className="chip" key={g}>
              {g}
            </span>
          ))}
        </dd>
        <dt>Never</dt>
        <dd>
          {[...role.write.deny, '.hub/**'].map((g) => (
            <span className="chip" key={g}>
              {g}
            </span>
          ))}
        </dd>
        <dt>Approval</dt>
        <dd>{role.approval ? `by ${role.approval}` : 'merges own tasks'}</dd>
      </dl>
    </div>
  ) : null;
