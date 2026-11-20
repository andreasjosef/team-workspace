import { describe, expect, it } from 'vitest';
import { RolePolicy } from './roles.ts';
import { CreateTaskInput } from './tasks.ts';

const valid = {
  role: 'cs',
  kind: 'bug',
  title: 'Discount code fails at checkout',
  text: 'Customer says SUMMER20 is rejected.',
};

describe('CreateTaskInput', () => {
  it('accepts a task from a known role', () => {
    expect(CreateTaskInput.safeParse(valid).success).toBe(true);
    expect(
      CreateTaskInput.safeParse({ ...valid, incidentId: 'INC-1042' }).success
    ).toBe(true);
  });

  it.each([
    { role: 'admin' },
    { kind: 'deploy' },
    { title: 'x' },
    { text: '' },
    { text: 'a'.repeat(4001) },
    { incidentId: '../../etc' },
  ])('rejects %o', (patch) => {
    expect(CreateTaskInput.safeParse({ ...valid, ...patch }).success).toBe(
      false
    );
  });
});

describe('RolePolicy', () => {
  it('needs at least one allowed path', () => {
    const policy = {
      name: 'cs',
      label: 'CS',
      description: '',
      systemPrompt: 'prompts/cs.md',
      canCreate: ['bug'],
      write: { allow: [], deny: [] },
      approval: 'dev',
    };
    expect(RolePolicy.safeParse(policy).success).toBe(false);
    expect(
      RolePolicy.safeParse({
        ...policy,
        write: { allow: ['src/**'], deny: [] },
      }).success
    ).toBe(true);
  });
});
