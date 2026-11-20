import { RoleScope, TaskList } from '../components/common.tsx';
import { TaskForm } from '../components/TaskForm.tsx';
import { useRoles, useTasks } from '../queries.ts';
import { devColumns } from '../taskView.ts';

// The dev's board: everyone's tasks, with what needs a review first. Every
// change from another role lands here before it can ship.
export const DevView = () => {
  const tasks = useTasks().data ?? [];
  const role = useRoles().data?.find((r) => r.name === 'dev');
  const cols = devColumns(tasks);

  return (
    <>
      <div className="cols cols-dev">
        <section className="panel">
          <h2>
            <span className="tone-gold">●</span> Needs your review (
            {cols.review.length})
          </h2>
          <TaskList
            tasks={cols.review}
            role="dev"
            empty="Nothing waiting for you."
          />
        </section>
        <section className="panel">
          <h2>
            <span className="tone-red">●</span> Flagged ({cols.flagged.length})
          </h2>
          <TaskList tasks={cols.flagged} role="dev" empty="Nothing stopped." />
        </section>
        <section className="panel">
          <h2>
            <span className="tone-blue">●</span> In progress (
            {cols.active.length})
          </h2>
          <TaskList tasks={cols.active} role="dev" empty="No agents running." />
        </section>
        <section className="panel">
          <h2>Closed</h2>
          <TaskList
            tasks={cols.closed.slice(0, 8)}
            role="dev"
            empty="Nothing shipped yet."
          />
        </section>
      </div>
      <div className="cols cols-task below">
        <section className="panel">
          <h2>New task</h2>
          <TaskForm role="dev" kinds={role?.canCreate ?? ['change', 'bug']} />
        </section>
        <RoleScope role={role} />
      </div>
    </>
  );
};
