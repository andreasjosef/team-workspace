import type { RolePolicy } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { checkPatch, diffTargets, gitDetail } from './workspace.ts';

const cs: RolePolicy = {
  name: 'cs',
  label: 'Customer support',
  description: '',
  systemPrompt: 'prompts/cs.md',
  canCreate: ['bug'],
  write: { allow: ['src/**'], deny: ['src/auth/**'] },
  maxChangedLines: 80,
  approval: 'dev',
};

const patch = (path: string, extra = '') =>
  `diff --git a/${path} b/${path}\n${extra}--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;

describe('checkPatch', () => {
  it('passes an in-scope patch', () => {
    expect(checkPatch(cs, patch('src/checkout/discount.ts'))).toBeNull();
  });

  it('refuses paths outside the scope, .hub included', () => {
    expect(checkPatch(cs, patch('src/auth/users.ts'))).toMatch(
      /deny src\/auth/
    );
    expect(checkPatch(cs, patch('.hub/roles/cs.json'))).toMatch(
      /never agent-writable/
    );
  });

  it('refuses symlinks, binary data and mode changes', () => {
    expect(checkPatch(cs, patch('src/x.ts', 'new file mode 120000\n'))).toMatch(
      /symlink/
    );
    expect(checkPatch(cs, patch('src/x.ts', 'GIT binary patch\n'))).toMatch(
      /binary/
    );
    expect(
      checkPatch(cs, patch('src/x.ts', 'old mode 100644\nnew mode 100755\n'))
    ).toMatch(/modes/);
  });

  it('checks both sides of a rename', () => {
    expect(diffTargets('diff --git a/src/a.ts b/src/auth/a.ts\n')).toEqual([
      'src/a.ts',
      'src/auth/a.ts',
    ]);
  });
});

describe('gitDetail', () => {
  it('redacts credentials in URLs and keeps git output to one line', () => {
    const out = [
      'remote: Invalid username or token.',
      "fatal: Authentication failed for 'https://x-access-token:ghp_secret123@github.com/demo/shop.git/'",
      '\u001b[31merror\u001b[0m: also at http://bot@example.com/r.git',
      '',
    ].join('\n');
    const detail = gitDetail(out);
    expect(detail).not.toMatch(/ghp_secret123|x-access-token|bot@/);
    expect(detail).toContain('https://***@github.com/demo/shop.git/');
    expect(detail).toContain('http://***@example.com/r.git');
    // eslint-disable-next-line no-control-regex
    expect(detail).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it('keeps the end of long output, where git puts the error', () => {
    const detail = gitDetail(`${'x'.repeat(500)} fatal: the end`, 50);
    expect(detail).toHaveLength(50);
    expect(detail).toMatch(/^….*fatal: the end$/);
  });
});
