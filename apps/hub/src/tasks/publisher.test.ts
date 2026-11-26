import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitMessage,
  createGitHubPublisher,
  createLocalPublisher,
} from './publisher.ts';
import { git, hubHead } from './workspace.ts';

let base: string;
let hubRepo: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hub-publisher-'));
  hubRepo = join(base, 'hub');
  await mkdir(join(hubRepo, 'src'), { recursive: true });
  await writeFile(join(hubRepo, 'src/a.ts'), 'a\n');
  const inHub = [
    `--git-dir=${join(hubRepo, '.git')}`,
    `--work-tree=${hubRepo}`,
  ];
  expect((await git(['init', '-q', '-b', 'main', hubRepo])).code).toBe(0);
  expect((await git([...inHub, 'add', '.'], { cwd: hubRepo })).code).toBe(0);
  expect(
    (await git([...inHub, 'commit', '-q', '-m', 'init'], { cwd: hubRepo })).code
  ).toBe(0);
});
afterEach(() => rm(base, { recursive: true, force: true }));

const patch =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n';

const localPublisher = () =>
  createLocalPublisher({
    hubRepoDir: hubRepo,
    scratchDir: join(base, 'tasks'),
  });

describe('local publisher', () => {
  it('publishes a branch and returns a file:// link, numbering each one', async () => {
    const publisher = localPublisher();
    const baseSha = await hubHead(hubRepo);
    const input = {
      baseSha,
      patch,
      title: 't',
      body: 'b',
      draft: false,
      message: 'fix: a',
      labels: [],
      log: () => {},
    };
    const first = await publisher.publish({ ...input, branch: 'task/one' });
    const second = await publisher.publish({ ...input, branch: 'task/two' });
    expect(first).toEqual({
      success: true,
      value: { url: `file://${hubRepo}#task/one`, number: 1 },
    });
    expect(second.success && second.value.number).toBe(2);
  });

  it('passes on a branch that could not be published as a failure', async () => {
    const publisher = localPublisher();
    const baseSha = await hubHead(hubRepo);
    const out = await publisher.publish({
      baseSha,
      branch: 'task/x',
      patch: patch.replace('-a', '-nope'),
      title: 't',
      body: 'b',
      draft: false,
      message: 'fix: a',
      labels: [],
      log: () => {},
    });
    expect(out.success).toBe(false);
  });
});

describe('commitMessage', () => {
  it('follows the fixed template, with the report id when there is one', () => {
    expect(
      commitMessage({
        title: 'Discount code says invalid',
        incidentId: 'INC-1042',
      })
    ).toBe('fix: Discount code says invalid (INC-1042)');
    expect(commitMessage({ title: 'Signup copy' })).toBe('fix: Signup copy');
  });

  it('keeps the untrusted title to one plain line', () => {
    const msg = commitMessage({
      title: 'Broken\n\nSigned-off-by: someone\u0007 ' + 'x'.repeat(200),
    });
    // eslint-disable-next-line no-control-regex
    expect(msg).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(msg.startsWith('fix: Broken Signed-off-by: someone x')).toBe(true);
    expect(msg.length).toBeLessThanOrEqual('fix: '.length + 72);
  });
});

// ---- GitHub: a bare repo stands in for origin, a fake fetch for the API ----

const TOKEN = 'ghp_test_token_publisher_0123456789';

type ApiCall = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

// Answers by path suffix; anything unscripted is a 404.
const fakeGitHub = (
  routes: Record<string, () => Response | Promise<Response>>
) => {
  const calls: ApiCall[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      method: init?.method ?? 'GET',
      url: href,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const key = Object.keys(routes).find((k) => href.endsWith(k));
    return key ? routes[key]!() : new Response('{}', { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
};

const json = (status: number, body: unknown, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const created = () =>
  json(201, { html_url: 'https://github.com/demo/shop/pull/7', number: 7 });

const FILE_OK = ['-c', 'protocol.file.allow=always'];

describe('GitHub publisher', () => {
  let origin: string;
  beforeEach(async () => {
    origin = join(base, 'origin.git');
    expect(
      (await git([...FILE_OK, 'clone', '-q', '--bare', '--', hubRepo, origin]))
        .code
    ).toBe(0);
    expect(
      (
        await git(
          [
            `--git-dir=${join(hubRepo, '.git')}`,
            'remote',
            'add',
            'origin',
            origin,
          ],
          { cwd: hubRepo }
        )
      ).code
    ).toBe(0);
  });

  const gitHubPublisher = (fetch: typeof globalThis.fetch) =>
    createGitHubPublisher({
      hubRepoDir: hubRepo,
      scratchDir: join(base, 'tasks'),
      repo: 'demo/shop',
      token: TOKEN,
      apiUrl: 'https://api.github.invalid/',
      fetch,
    });

  const publishInput = async (log: (m: string) => void = () => {}) => ({
    baseSha: await hubHead(hubRepo),
    branch: 'task/gh1',
    patch,
    title: '[support] INC-1042: Discount code says invalid',
    body: 'The receipt.',
    draft: false,
    message: 'fix: Discount code says invalid (INC-1042)',
    labels: ['from-support', 'INC-1042'],
    log,
  });

  const inOrigin = async (args: string[]) =>
    (await git([`--git-dir=${origin}`, ...args])).out.trim();

  it('pushes the branch, opens the pull request and labels it', async () => {
    const mainBefore = await inOrigin(['rev-parse', 'main']);
    const api = fakeGitHub({
      '/repos/demo/shop/pulls': created,
      '/repos/demo/shop/issues/7/labels': () => json(200, []),
    });

    const out = await gitHubPublisher(api.fetch).publish(await publishInput());

    expect(out).toEqual({
      success: true,
      value: { url: 'https://github.com/demo/shop/pull/7', number: 7 },
    });
    expect(await inOrigin(['log', '--format=%s|%P', '-1', 'task/gh1'])).toBe(
      `fix: Discount code says invalid (INC-1042)|${mainBefore}`
    );
    expect(await inOrigin(['rev-parse', 'main'])).toBe(mainBefore);

    const [pr, labels] = api.calls;
    expect(pr).toMatchObject({
      method: 'POST',
      url: 'https://api.github.invalid/repos/demo/shop/pulls',
      body: {
        head: 'task/gh1',
        base: 'main',
        title: '[support] INC-1042: Discount code says invalid',
        body: 'The receipt.',
        draft: false,
      },
    });
    expect(pr!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(pr!.headers.accept).toBe('application/vnd.github+json');
    expect(labels).toMatchObject({
      method: 'POST',
      url: 'https://api.github.invalid/repos/demo/shop/issues/7/labels',
      body: { labels: ['from-support', 'INC-1042'] },
    });
    expect(api.calls).toHaveLength(2);
  });

  it('keeps the pull request when labelling fails, and logs it', async () => {
    const logged: string[] = [];
    const api = fakeGitHub({
      '/repos/demo/shop/pulls': created,
      '/repos/demo/shop/issues/7/labels': () =>
        json(403, { message: 'Resource not accessible by integration' }),
    });
    const out = await gitHubPublisher(api.fetch).publish(
      await publishInput((m) => logged.push(m))
    );
    expect(out.success).toBe(true);
    expect(logged).toEqual([
      expect.stringMatching(/^Labelling pull request #7 failed: .*403/),
    ]);
  });

  it('keeps the pull request when the label call throws', async () => {
    const logged: string[] = [];
    const api = fakeGitHub({
      '/repos/demo/shop/pulls': created,
      '/repos/demo/shop/issues/7/labels': () => {
        throw new TypeError('fetch failed');
      },
    });
    const out = await gitHubPublisher(api.fetch).publish(
      await publishInput((m) => logged.push(m))
    );
    expect(out.success).toBe(true);
    expect(logged[0]).toMatch(/Labelling pull request #7 failed/);
  });

  it.each([
    [
      'a duplicate',
      () =>
        json(422, {
          message: 'Validation Failed',
          errors: [
            { message: 'A pull request already exists for demo:task/gh1.' },
          ],
        }),
      /^GitHub refused the pull request \(422\): A pull request already exists for demo:task\/gh1\./,
    ],
    [
      'a bad token',
      () => json(401, { message: 'Bad credentials' }),
      /^GitHub rejected the token \(401\)/,
    ],
    [
      'the rate limit',
      () =>
        json(
          403,
          { message: 'API rate limit exceeded' },
          { 'x-ratelimit-remaining': '0' }
        ),
      /^GitHub rate limit reached \(403\)/,
    ],
    [
      'a secondary rate limit',
      () => json(429, { message: 'slow down' }),
      /^GitHub rate limit reached \(429\)/,
    ],
    [
      'an unreachable API',
      () => {
        throw new TypeError('fetch failed');
      },
      /^GitHub API unreachable: fetch failed/,
    ],
    [
      'an answer without a pull request',
      () => json(201, { nope: true }),
      /^GitHub answered 201 without a pull request/,
    ],
  ])(
    'fails on %s with a short reason, the branch still pushed',
    async (_, reply, reason) => {
      const api = fakeGitHub({ '/repos/demo/shop/pulls': reply });
      const out = await gitHubPublisher(api.fetch).publish(
        await publishInput()
      );
      expect(out.success).toBe(false);
      const message = !out.success ? out.message : '';
      expect(message).toMatch(reason);
      expect(message).toContain('task/gh1 is pushed');
      expect(message.length).toBeLessThan(300);
      expect(message).not.toContain(TOKEN);
      expect(await inOrigin(['rev-parse', '--verify', 'task/gh1'])).toMatch(
        /^[0-9a-f]{40}$/
      );
      // No labels on a pull request that isn't there.
      expect(api.calls).toHaveLength(1);
    }
  );

  it('keeps a long or odd API message to one short line', async () => {
    const api = fakeGitHub({
      '/repos/demo/shop/pulls': () =>
        json(500, { message: `boom\n\u001b[31m${'x'.repeat(1000)}` }),
    });
    const out = await gitHubPublisher(api.fetch).publish(await publishInput());
    const message = !out.success ? out.message : '';
    // eslint-disable-next-line no-control-regex
    expect(message).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(message.length).toBeLessThan(300);
  });

  it('does not call the API when the push fails', async () => {
    await git([
      `--git-dir=${join(hubRepo, '.git')}`,
      'remote',
      'remove',
      'origin',
    ]);
    const api = fakeGitHub({ '/repos/demo/shop/pulls': created });
    const out = await gitHubPublisher(api.fetch).publish(await publishInput());
    expect(out.success).toBe(false);
    expect(!out.success && out.message).toMatch(/git push failed/);
    expect(api.calls).toEqual([]);
  });
});
