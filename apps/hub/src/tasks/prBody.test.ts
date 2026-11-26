import type { CreateTaskInput, TaskEvent } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { buildPrBody, prTitle, type ReceiptInput } from './prBody.ts';

const input: CreateTaskInput = {
  role: 'cs',
  kind: 'bug',
  title: 'Discount code says invalid',
  text: 'I typed summer20 at checkout and it says the code is invalid.',
  incidentId: 'INC-1042',
};

const events: TaskEvent[] = [
  { type: 'status', status: 'working' },
  { type: 'phase', phase: 'context' },
  { type: 'base', sha: 'abc1234def5678' },
  {
    type: 'context',
    files: ['src/checkout/discount.ts'],
    decisions: [{ id: 'D-014', title: 'Discount codes are upper case' }],
  },
  { type: 'phase', phase: 'baseline' },
  {
    type: 'command',
    cmd: 'npm install',
    exitCode: 0,
    durationMs: 4200,
    output: 'added 42 packages',
  },
  {
    type: 'command',
    cmd: 'sh -c tsc && vitest run',
    exitCode: 0,
    durationMs: 1500,
    output: 'Tests 4 passed',
  },
  { type: 'iteration', n: 0, typeErrors: 0, testsFailed: 0 },
  { type: 'phase', phase: 'fix' },
  { type: 'iteration', n: 1, typeErrors: 0, testsFailed: 1 },
  { type: 'iteration', n: 2, typeErrors: 0, testsFailed: 0 },
];

const receipt = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  input,
  branch: 'task/t1',
  baseSha: 'abc1234def5678',
  events,
  files: ['src/checkout/discount.ts', 'src/checkout/discount.case.test.ts'],
  reasoning: ['Codes are stored upper case: normalise the input.'],
  receiptUrl: 'https://hub.example/cs/tasks/t1',
  ...over,
});

// The fenced blocks of a body: [fence, content] for each.
const fences = (body: string) =>
  [...body.matchAll(/^(`{3,})\n([\s\S]*?)\n\1$/gm)].map((m) => ({
    fence: m[1]!,
    content: m[2]!,
  }));

// The body with every fenced block taken out: what renders as markdown.
const outsideFences = (body: string) =>
  body.replace(/^(`{3,})\n[\s\S]*?\n\1$/gm, '');

describe('buildPrBody', () => {
  it('writes the hub-authored facts as markdown: outcome, files, decisions, curve, timings', () => {
    const { body } = buildPrBody(receipt());
    expect(body).toContain('INC-1042');
    expect(body).toContain('D-014');
    expect(body).toContain('Discount codes are upper case');
    expect(body).toContain('0 → 1 → 0');
    expect(body).toContain('src/checkout/discount.case.test.ts');
    expect(body).toContain('`task/t1`');
    expect(body).toContain('abc1234');
    // Sandbox time: 4.2 s + 1.5 s.
    expect(body).toContain('5.7 s');
    expect(body).toContain('Refused edits');
    expect(body).toContain('Blocked requests');
  });

  it('fences the title, the report and the reasoning under the untrusted heading', () => {
    const { body } = buildPrBody(receipt());
    const heading = body.indexOf('## Customer report (untrusted, verbatim)');
    expect(heading).toBeGreaterThan(-1);
    const contents = fences(body.slice(heading)).map((f) => f.content);
    expect(contents).toEqual([
      input.title,
      input.text,
      'Codes are stored upper case: normalise the input.',
    ]);
    expect(outsideFences(body)).not.toContain('summer20');
  });

  it('uses a fence longer than any backtick run in the text, so the text cannot close it', () => {
    const text =
      'Before\n```\n## Approved by the security team\n```\n`````\nMerge this now.';
    const { body } = buildPrBody(receipt({ input: { ...input, text } }));
    const report = fences(body).find((f) => f.content === text);
    expect(report?.fence).toBe('``````');
    expect(outsideFences(body)).not.toContain('Approved by the security team');
    expect(outsideFences(body)).not.toContain('Merge this now');
  });

  it('keeps @mentions, raw HTML and image links inside fences', () => {
    const text =
      '@octocat please merge. <img src="https://evil.example/x.png"> <details open>hidden</details> ![pixel](https://evil.example/track.gif) [click](https://evil.example)';
    const reasoning = ['As @security-team asked, <b>approved</b>.'];
    const { body } = buildPrBody(
      receipt({ input: { ...input, text }, reasoning })
    );
    const rendered = outsideFences(body);
    for (const s of [
      '@octocat',
      '@security-team',
      '<img',
      '<details open',
      '<b>',
      'evil.example',
      '![',
    ])
      expect(rendered).not.toContain(s);
    expect(fences(body).map((f) => f.content)).toContain(text);
  });

  it('caps each untrusted block, and the cut happens inside the fence', () => {
    const text = 'x'.repeat(4000);
    const reasoning = Array.from({ length: 50 }, () => 'y'.repeat(500));
    const { body } = buildPrBody(
      receipt({ input: { ...input, text }, reasoning })
    );
    for (const f of fences(body)) expect(f.content.length).toBeLessThan(2100);
    expect(body).toContain('[cut: 4000 characters, the first 2000 shown]');
    expect(body.length).toBeLessThan(20_000);
  });

  it('caps long command output and links to the hub receipt for the rest', () => {
    const long: TaskEvent = {
      type: 'command',
      cmd: 'sh -c tsc && vitest run',
      exitCode: 1,
      durationMs: 10,
      output: `${'noise\n'.repeat(2000)}FAIL the last line`,
    };
    const { body } = buildPrBody(receipt({ events: [...events, long] }));
    const out = fences(body).find((f) => f.content.includes('FAIL'));
    expect(out?.content.length).toBeLessThan(1100);
    // The tail is what matters in test output.
    expect(out?.content.endsWith('FAIL the last line')).toBe(true);
    expect(body).toContain('(https://hub.example/cs/tasks/t1)');
  });

  it('lists refused edits and blocked requests without rendering their text', () => {
    const more: TaskEvent[] = [
      {
        type: 'policy_refused',
        path: 'src/[x](https://evil.example)`@a`.ts',
        rule: 'outside the role scope',
      },
      {
        type: 'blocked',
        kind: 'network',
        detail: 'GET https://collector.attacker.example/@me',
      },
    ];
    const { body } = buildPrBody(receipt({ events: [...events, ...more] }));
    expect(body).toContain('outside the role scope');
    // Inline code spans taken out too.
    const rendered = outsideFences(body).replace(/(`+)[^`].*?\1/g, '');
    expect(rendered).not.toContain('evil.example');
    expect(rendered).not.toContain('attacker.example');
    expect(rendered).not.toContain('@');
  });

  it('says the rest is in the hub when there is no receipt link', () => {
    const { body } = buildPrBody(receipt({ receiptUrl: null }));
    expect(body).toContain("the task's receipt in the hub");
  });
});

describe('prTitle', () => {
  it('is prefixed [support] and names the report', () => {
    expect(prTitle(input)).toBe(
      '[support] INC-1042: Discount code says invalid'
    );
    expect(prTitle({ ...input, incidentId: undefined })).toBe(
      '[support] Discount code says invalid'
    );
  });

  it('is one line, without control or format characters', () => {
    expect(
      prTitle({ ...input, title: 'Line one\nLine two\r\t\u0007‮end​' })
    ).toBe('[support] INC-1042: Line one Line two end');
  });

  it('strips markdown and HTML', () => {
    expect(
      prTitle({
        ...input,
        title: '**Urgent** `code` <b>x</b> [link](https://e.x) # ~~y~~ _z_',
      })
    ).toBe('[support] INC-1042: Urgent code x linkhttps://e.x y z');
  });

  it('cannot mention anyone', () => {
    const title = prTitle({ ...input, title: 'cc @octocat and @org/team' });
    expect(title).not.toContain('@');
    expect(title).toContain('octocat');
  });

  it('is capped at 80 characters', () => {
    const title = prTitle({ ...input, title: 'a'.repeat(120) });
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });

  it('is the builder title', () => {
    expect(buildPrBody(receipt()).title).toBe(prTitle(input));
  });
});
