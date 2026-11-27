import { describe, expect, it } from 'vitest';
import { langOf, lineSpans, parseDiff, tokenize } from './diffView.ts';

const DIFF = `diff --git a/src/discount.ts b/src/discount.ts
index 3f1c2a1..8b0d7e4 100644
--- a/src/discount.ts
+++ b/src/discount.ts
@@ -10,4 +10,4 @@ export const findDiscount = () => {
 const a = 1;
-  const discount = CODES[input.trim()];
+  const discount = CODES[input.trim().toUpperCase()];
 return discount;
diff --git a/notes.md b/notes.md
new file mode 100644
--- /dev/null
+++ b/notes.md
@@ -0,0 +1,2 @@
+-- a line starting with dashes
+second
`;

describe('parseDiff', () => {
  const files = parseDiff(DIFF);

  it('splits files and counts their lines', () => {
    expect(files.map((f) => [f.path, f.status, f.adds, f.dels])).toEqual([
      ['src/discount.ts', 'modified', 1, 1],
      ['notes.md', 'added', 2, 0],
    ]);
  });

  it('numbers lines from the hunk header and keeps its context', () => {
    const [hunk] = files[0]!.hunks;
    expect(hunk!.range).toBe('@@ -10,4 +10,4 @@');
    expect(hunk!.context).toBe('export const findDiscount = () => {');
    expect(
      hunk!.lines.map((l) => [l.kind, l.oldNo ?? null, l.newNo ?? null])
    ).toEqual([
      ['ctx', 10, 10],
      ['del', 11, null],
      ['add', null, 11],
      ['ctx', 12, 12],
    ]);
  });

  it('reads content lines that look like file headers as content', () => {
    expect(files[1]!.hunks[0]!.lines[0]).toMatchObject({
      kind: 'add',
      text: '-- a line starting with dashes',
    });
  });

  it('marks the changed part of a paired deletion and addition', () => {
    const [, del, add] = files[0]!.hunks[0]!.lines;
    expect(del!.text.slice(...del!.change!)).toBe('');
    expect(add!.text.slice(...add!.change!)).toBe('.toUpperCase()');
  });

  it('returns no files for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

describe('tokenize', () => {
  it('colours TS and leaves other files plain', () => {
    const cls = (text: string) =>
      tokenize(text, 'ts')
        .filter((t) => t.cls)
        .map((t) => `${t.cls}:${t.text}`);
    expect(cls("const x = f('a'); // hi")).toEqual([
      'kw:const',
      'id:x',
      'op:=',
      'fn:f',
      'pun:(',
      "str:'a'",
      'pun:)',
      'pun:;',
      'com:// hi',
    ]);
    expect(tokenize('const x', 'plain')).toEqual([
      { text: 'const x', cls: '' },
    ]);
    expect(langOf('a/b.tsx')).toBe('ts');
    expect(langOf('README.md')).toBe('plain');
  });
});

describe('lineSpans', () => {
  it('cuts tokens at the change boundaries', () => {
    const spans = lineSpans(
      { kind: 'add', text: 'fooBar()', change: [3, 6] },
      'ts'
    );
    expect(spans.map((s) => [s.text, s.cls, s.changed])).toEqual([
      ['foo', 'fn', false],
      ['Bar', 'fn', true],
      ['(', 'pun', false],
      [')', 'pun', false],
    ]);
  });
});
