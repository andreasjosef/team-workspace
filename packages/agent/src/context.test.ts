import { describe, expect, it } from 'vitest';
import { matchDecisions, parseDoc, parseList, rankFiles } from './context.ts';

const decision = parseDoc(
  'decisions/D-014-discount-codes.md',
  `---
id: D-014
title: Discount codes are case-insensitive
date: 2026-03-12
by: Sara (PO)
files: ["src/checkout/discount.ts"]
---
Customers type codes from emails in any case.
`
);

const pricing = parseDoc(
  'decisions/D-009-pricing.md',
  '---\nid: D-009\ntitle: Annual plans get two months free\nfiles: ["src/billing/plans.ts"]\n---\nBody.'
);

describe('parseList', () => {
  it('reads flow lists the way YAML tools write them', () => {
    expect(parseList('["src/a.ts", "src/b.ts"]')).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(parseList("['src/web/signup.ts']")).toEqual(['src/web/signup.ts']);
    expect(parseList('[src/a.ts]')).toEqual(['src/a.ts']);
  });

  it('gives up on anything else', () => {
    expect(parseList('[oops')).toEqual([]);
    expect(parseList('src/a.ts')).toEqual([]);
  });
});

describe('parseDoc', () => {
  it('reads front matter and the linked files', () => {
    expect(decision).toMatchObject({
      kind: 'decision',
      id: 'D-014',
      title: 'Discount codes are case-insensitive',
      by: 'Sara (PO)',
      files: ['src/checkout/discount.ts'],
      body: 'Customers type codes from emails in any case.',
    });
  });

  it('reads a CRLF decision the same as its LF version', () => {
    const lf =
      '---\nid: D-014\ntitle: Discount codes are case-insensitive\nfiles: ["src/checkout/discount.ts"]\n---\nLine one.\nLine two.\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const path = 'decisions/D-014-discount-codes.md';
    expect(parseDoc(path, crlf)).toEqual(parseDoc(path, lf));
    expect(parseDoc(path, crlf)).toMatchObject({
      id: 'D-014',
      files: ['src/checkout/discount.ts'],
    });
  });

  it('falls back to the first heading for plain docs', () => {
    expect(
      parseDoc('docs/onboarding.md', '# Onboarding\n\nText')
    ).toMatchObject({
      kind: 'doc',
      title: 'Onboarding',
      files: [],
    });
  });

  it('survives broken front matter', () => {
    expect(
      parseDoc('decisions/x.md', '---\nfiles: [oops\n---\nx').files
    ).toEqual([]);
  });
});

describe('rankFiles and matchDecisions', () => {
  const files = [
    {
      path: 'src/checkout/discount.ts',
      content: 'export const applyDiscount = (code) => CODES[code]',
    },
    { path: 'src/auth/users.ts', content: 'export const admins = []' },
    {
      path: 'src/web/signup.ts',
      content: "export const signupButton = 'Sign up'",
    },
  ];
  const text = 'Discount codes fail at checkout when typed in lower case';

  it('finds the file the ticket is about', () => {
    expect(rankFiles(files, text)[0]).toBe('src/checkout/discount.ts');
  });

  it('brings in the decision linked to that file, and not unrelated ones', () => {
    expect(
      matchDecisions([decision, pricing], ['src/checkout/discount.ts'], text)
    ).toEqual([decision]);
  });
});

describe('rankFiles noise floor', () => {
  it('leaves out files that share only a word or two with the ticket', () => {
    const files = [
      {
        path: 'src/checkout/discount.ts',
        content: 'discount code checkout invalid',
      },
      { path: 'src/auth/users.ts', content: 'export type User' },
    ];
    expect(
      rankFiles(files, 'Discount code invalid at checkout, type it')
    ).toEqual(['src/checkout/discount.ts']);
  });
});
