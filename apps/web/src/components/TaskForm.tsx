import type { Role, TaskKind } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, unwrap } from '../api.ts';

export type TaskDraft = { title: string; text: string; incidentId?: string };

// One form for every role; the kinds offered come from the role's policy.
// `draft` prefills it (a decision to change, an incident to fix); the `key`
// on the caller resets it when the draft changes.
export const TaskForm = ({
  role,
  kinds,
  draft,
  submitLabel = 'Start task',
}: {
  role: Role;
  kinds: TaskKind[];
  draft?: TaskDraft;
  submitLabel?: string;
}) => {
  const [title, setTitle] = useState(draft?.title ?? '');
  const [text, setText] = useState(draft?.text ?? '');
  const [kind, setKind] = useState<TaskKind>(kinds[0] ?? 'change');
  const navigate = useNavigate();
  const client = useQueryClient();

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.createTask({
          role,
          kind,
          title,
          text,
          ...(draft?.incidentId ? { incidentId: draft.incidentId } : {}),
        })
      ),
    onSuccess: ({ taskId }) => {
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void navigate(`/${role}/tasks/${taskId}`);
    },
  });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      {kinds.length > 1 && (
        <label className="field">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TaskKind)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What should change?"
        />
      </label>
      <label className="field">
        Details
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What you see, what you want"
        />
      </label>
      <div>
        <button
          className="btn btn-primary"
          disabled={create.isPending || title.trim().length < 3 || !text.trim()}
        >
          {create.isPending ? 'Starting…' : submitLabel}
        </button>
      </div>
      {create.isError && <p className="error">{create.error.message}</p>}
    </form>
  );
};
