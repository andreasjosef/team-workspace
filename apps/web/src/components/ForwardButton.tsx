import type { Incident } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../api.ts';

// One button from a customer's report to an agent working on it. The report
// goes in exactly as the customer wrote it; the hub treats it as untrusted.
export const ForwardButton = ({
  report,
  onStarted,
}: {
  report: Incident;
  onStarted?: (taskId: string) => void;
}) => {
  const client = useQueryClient();
  const forward = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.createTask({
          role: 'cs',
          kind: 'bug',
          title: report.subject,
          text: report.body,
          incidentId: report.id,
        })
      ),
    onSuccess: (created) => {
      onStarted?.(created.taskId);
      void client.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <div className="forward">
      <button
        className="btn btn-primary btn-big"
        disabled={forward.isPending}
        onClick={() => forward.mutate()}
      >
        {forward.isPending ? 'Forwarding…' : 'Ask the agent to fix it'}
      </button>
      <p className="muted small">
        The agent reproduces the problem in a sandbox, fixes it within its
        limits, and a developer reviews the change. No secrets, no network.
      </p>
      {forward.isError && <p className="error">{forward.error.message}</p>}
    </div>
  );
};
