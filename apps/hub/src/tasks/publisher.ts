import { fail, ok, type CreateTaskInput, type Result } from '@app/shared';
import { z } from 'zod';
import { publishBranch, pushBranch } from './workspace.ts';

// How a green task leaves the hub: as a pull request, never a commit on
// main. Publishing is the pipeline's last step; which publisher it gets is
// the start-up wiring's choice (index.ts). Both start their tasks from the
// same sync to origin's main (hubSync.ts), whose `baseSha` they branch from.
//
// - Local (`GITHUB_REPO` unset): a branch in the hub repo and a file:// link.
// - GitHub (`GITHUB_REPO` set): push the branch to origin, open the pull
//   request through the API.
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
  // Labels for the pull request (`from-support`, the report id). Best
  // effort: a publisher that can't add them logs it and carries on.
  labels: string[];
  // A line for the task log.
  log: (message: string) => void;
};

export type Publisher = {
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

// With GitHub: the branch is published in the hub repo as above, pushed to
// origin (the GitHub repo the hub repo is a clone of), and opened as a pull
// request against `main`. The token goes to the push's git process (see
// `pushBranch`) and to the API as a bearer header, nowhere else.
//
// Once the push worked, a failure leaves the branch on GitHub: the reason
// says so, and a developer can still open the pull request by hand.
export const createGitHubPublisher = (opts: {
  hubRepoDir: string;
  scratchDir: string;
  // `owner/name`, validated by the env schema.
  repo: string;
  token: string;
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
}): Publisher => {
  const fetch = opts.fetch ?? globalThis.fetch;
  const [owner = '', name = ''] = opts.repo.split('/');
  const repoUrl = `${opts.apiUrl.replace(/\/+$/, '')}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const post = (path: string, body: unknown) =>
    fetch(`${repoUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'team-workspace-hub',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

  return {
    publish: async (input) => {
      const published = await publishBranch(opts.hubRepoDir, opts.scratchDir, {
        baseSha: input.baseSha,
        branch: input.branch,
        patch: input.patch,
        message: input.message,
      });
      if (!published.success) return published;
      const pushed = await pushBranch(
        opts.hubRepoDir,
        input.branch,
        opts.token
      );
      if (!pushed.success) return pushed;

      const opened = await openPullRequest(post, input);
      if (!opened.success)
        return fail(
          opened.code,
          `${opened.message}; branch ${input.branch} is pushed`
        );
      if (input.labels.length) {
        const labelled = await addLabels(
          post,
          opened.value.number,
          input.labels
        );
        if (labelled) input.log(labelled);
      }
      return opened;
    },
  };
};

type Post = (path: string, body: unknown) => Promise<Response>;

const CreatedPullRequest = z.object({
  html_url: z.url(),
  number: z.number().int().positive(),
});

const openPullRequest = async (
  post: Post,
  input: PublishInput
): Promise<Result<{ url: string; number: number }>> => {
  let res: Response;
  try {
    res = await post('/pulls', {
      head: input.branch,
      base: 'main',
      title: input.title,
      body: input.body,
      draft: input.draft,
    });
  } catch (err) {
    return fail('unavailable', `GitHub API unreachable: ${errorText(err)}`);
  }
  const answer: unknown = await res.json().catch(() => null);
  if (!res.ok) return fail('unavailable', apiError(res, answer));
  const pr = CreatedPullRequest.safeParse(answer);
  if (!pr.success)
    return fail(
      'unavailable',
      `GitHub answered ${res.status} without a pull request`
    );
  return ok({ url: pr.data.html_url, number: pr.data.number });
};

// Returns a line for the task log on failure, null when the labels are on.
const addLabels = async (post: Post, number: number, labels: string[]) => {
  const failed = (why: string) =>
    `Labelling pull request #${number} failed: ${why}`;
  try {
    const res = await post(`/issues/${number}/labels`, { labels });
    if (res.ok) return null;
    return failed(apiError(res, await res.json().catch(() => null)));
  } catch (err) {
    return failed(errorText(err));
  }
};

const ApiErrorBody = z.object({
  message: z.string().optional(),
  errors: z.array(z.object({ message: z.string() }).partial()).optional(),
});

// One short line for the task's reason: what GitHub said, without its
// control characters, capped.
const apiError = (res: Response, answer: unknown) => {
  const body = ApiErrorBody.safeParse(answer);
  const said = body.success
    ? (body.data.errors?.find((e) => e.message)?.message ?? body.data.message)
    : undefined;
  const detail = said ? `: ${oneLine(said)}` : '';
  const status = res.status;
  if (status === 401) return `GitHub rejected the token (401)${detail}`;
  if (
    status === 429 ||
    (status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
  )
    return `GitHub rate limit reached (${status})${detail}`;
  if (status === 422) return `GitHub refused the pull request (422)${detail}`;
  return `GitHub API returned ${status}${detail}`;
};

const errorText = (err: unknown) =>
  oneLine(err instanceof Error ? err.message : String(err));

const MAX_DETAIL = 160;

const oneLine = (text: string) => {
  const line = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1)}…` : line;
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
