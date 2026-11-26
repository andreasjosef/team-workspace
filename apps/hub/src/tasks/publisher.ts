import { ok, type CreateTaskInput, type Result } from '@app/shared';
import { hubHead, publishBranch } from './workspace.ts';

// How a green task leaves the hub: as a pull request, never a commit on
// main. The pipeline syncs before a task starts and publishes as its last
// step; which publisher it gets is the start-up wiring's choice (index.ts).
//
// - Local (`GITHUB_REPO` unset): a branch in the hub repo and a file:// link.
// - GitHub (a later change): fetch + reset before each task, push the
//   branch, open the pull request.
//
// The pipeline runs `checkPatch` before `publish`, whichever publisher it is.
export type PublishInput = {
  branch: string;
  // The commit the task started from: the branch is cut here, not at the
  // hub's current main.
  baseSha: string;
  patch: string;
  // The pull request's title and body (the receipt).
  title: string;
  body: string;
  draft: boolean;
  // The commit message, from the fixed template (`commitMessage`).
  message: string;
};

export type Publisher = {
  // Brings the hub repo up to date and says which commit tasks start from.
  // `fetched` is false when nothing was fetched (local, or a failed fetch).
  sync: () => Promise<{ baseSha: string; fetched: boolean }>;
  publish: (
    input: PublishInput
  ) => Promise<Result<{ url: string; number: number }>>;
};

// Without GitHub: the branch is created in the hub repo itself, and the
// "pull request" is a link to it, numbered from 1 since the hub started.
export const createLocalPublisher = (opts: {
  hubRepoDir: string;
  // Where the publishing worktree goes: the host's tasks dir.
  scratchDir: string;
}): Publisher => {
  let opened = 0;
  return {
    sync: async () => ({
      baseSha: await hubHead(opts.hubRepoDir),
      fetched: false,
    }),
    publish: async (input) => {
      const published = await publishBranch(opts.hubRepoDir, opts.scratchDir, {
        baseSha: input.baseSha,
        branch: input.branch,
        patch: input.patch,
        message: input.message,
      });
      if (!published.success) return published;
      opened++;
      return ok({
        url: `file://${opts.hubRepoDir}#${input.branch}`,
        number: opened,
      });
    },
  };
};

const MAX_SUBJECT = 72;

// The commit message on a published branch: `fix: <title> (<report id>)`.
// The title is untrusted, so it's cut to one plain line: no control
// characters or line breaks (which could add a trailer), capped. The report
// id is validated by CreateTaskInput.
export const commitMessage = (
  input: Pick<CreateTaskInput, 'title' | 'incidentId'>
) => {
  const title = input.title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const capped =
    title.length > MAX_SUBJECT ? `${title.slice(0, MAX_SUBJECT - 1)}…` : title;
  return `fix: ${capped}${input.incidentId ? ` (${input.incidentId})` : ''}`;
};
