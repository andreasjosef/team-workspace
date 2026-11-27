import { describe, expect, it } from 'vitest';
import { detectLang, parseDiff } from './diffView.ts';

describe('parseDiff', () => {
  it('parses modified and newly created files with line numbers and counts', () => {
    const raw = [
      'diff --git a/src/checkout/discount.ts b/src/checkout/discount.ts',
      'index 1111111..2222222 100644',
      '--- a/src/checkout/discount.ts',
      '+++ b/src/checkout/discount.ts',
      '@@ -10,3 +10,3 @@ export function applyDiscount(code: string) {',
      '   const trimmed = code.trim();',
      '-  return CODES[trimmed] ?? 0;',
      '+  return CODES[trimmed.toUpperCase()] ?? 0;',
      ' }',
      'diff --git a/src/checkout/discount-case.test.ts b/src/checkout/discount-case.test.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/checkout/discount-case.test.ts',
      '@@ -0,0 +1,2 @@',
      "+import { expect, it } from 'vitest';",
      "+it('accepts lowercase', () => expect(true).toBe(true));",
    ].join('\n');

    const files = parseDiff(raw);
    expect(files).toHaveLength(2);

    const mod = files[0]!;
    expect(mod.path).toBe('src/checkout/discount.ts');
    expect(mod.status).toBe('modified');
    expect(mod.lang).toBe('typescript');
    expect(mod.additions).toBe(1);
    expect(mod.deletions).toBe(1);
    expect(mod.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['hunk', null, null],
      ['context', 10, 10],
      ['del', 11, null],
      ['add', null, 11],
      ['context', 12, 12],
    ]);

    const added = files[1]!;
    expect(added.path).toBe('src/checkout/discount-case.test.ts');
    expect(added.status).toBe('added');
    expect(added.additions).toBe(2);
    expect(added.deletions).toBe(0);
  });

  it('detects languages from file extensions', () => {
    expect(detectLang('src/App.tsx')).toBe('tsx');
    expect(detectLang('package.json')).toBe('json');
    expect(detectLang('apps/web/src/styles.css')).toBe('css');
    expect(detectLang('README.md')).toBe('markdown');
    expect(detectLang('unknown.xyz')).toBe('text');
  });
});
