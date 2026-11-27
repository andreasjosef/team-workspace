import type { RolePolicy } from '@app/shared';
import { describe, expect, it } from 'vitest';
import {
  buildTaskMessages,
  promptSections,
  type TaskContext,
} from './prompt.ts';

const cs: RolePolicy = {
  name: 'cs',
  label: 'Customer support',
  description: '',
  systemPrompt: 'prompts/cs.md',
  canCreate: ['bug'],
  write: { allow: ['src/**'], deny: ['src/auth/**'] },
  maxChangedLines: 50,
  approval: 'dev',
};

const ctx = (text: string): TaskContext => ({
  policy: cs,
  rolePrompt: 'You are the support agent.',
  task: {
    role: 'cs',
    kind: 'bug',
    title: 'Checkout broken',
    text,
    incidentId: 'INC-1',
  },
  decisions: [],
  files: [],
  errors: '',
});

describe('promptSections', () => {
  it('cuts a long report inside its untrusted wrapper, keeping the wrapper whole', () => {
    const text = `Checkout fails. ${'More words. '.repeat(1000)}`;
    const report = promptSections(ctx(text), 500).find(
      (s) => s.title === "The customer's report"
    )!;
    expect(report.text).toMatch(
      /^Task \(bug, from Customer support\): Checkout broken\n\n<untrusted source="incident INC-1">\nCheckout fails\. [\s\S]*…\n<\/untrusted>$/
    );
    expect(report.text.length).toBeLessThanOrEqual(501);
    expect(report.chars).toBeGreaterThan(text.length);
  });

  it('leaves a section within the cap as the model gets it', () => {
    const c = ctx('Checkout fails.');
    const report = promptSections(c, 4000).find(
      (s) => s.title === "The customer's report"
    )!;
    expect(report.text.length).toBe(report.chars);
    expect(buildTaskMessages(c)[1]!.content).toContain(report.text);
  });
});
