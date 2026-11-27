// Parse a unified diff into files, hunks and lines for the Changes tab, and
// colour code lines with a small tokenizer. Good enough for TS/JS; any other
// file renders as plain text.

export type DiffLine = {
  kind: 'ctx' | 'add' | 'del';
  oldNo?: number;
  newNo?: number;
  text: string;
  // The changed span [start, end) when this line pairs with one on the
  // other side of the change.
  change?: [number, number];
};
export type Hunk = { range: string; context: string; lines: DiffLine[] };
export type FileDiff = {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  hunks: Hunk[];
  adds: number;
  dels: number;
};

const HUNK_RE = /^(@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@) ?(.*)$/;

export const parseDiff = (diff: string): FileDiff[] => {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const path = raw.split(' b/').pop() ?? raw;
      file = { path, status: 'modified', hunks: [], adds: 0, dels: 0 };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (raw.startsWith('new file')) file.status = 'added';
      else if (raw.startsWith('deleted file')) file.status = 'deleted';
    }
    const m = HUNK_RE.exec(raw);
    if (m) {
      oldNo = Number(m[2]);
      newNo = Number(m[3]);
      hunk = { range: m[1]!, context: m[4] ?? '', lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk || raw.startsWith('\\')) continue;
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === '+') {
      hunk.lines.push({ kind: 'add', newNo: newNo++, text });
      file.adds++;
    } else if (sign === '-') {
      hunk.lines.push({ kind: 'del', oldNo: oldNo++, text });
      file.dels++;
    } else if (sign === ' ' || raw === '') {
      hunk.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text });
    }
  }
  for (const f of files)
    for (const h of f.hunks) {
      // The diff's final newline leaves an empty context line behind.
      while (h.lines.at(-1)?.kind === 'ctx' && h.lines.at(-1)?.text === '')
        h.lines.pop();
      markChanges(h.lines);
    }
  return files;
};

// Pair each run of deletions with the additions right after it, and mark
// the span between their common prefix and suffix as the changed part.
const markChanges = (lines: DiffLine[]) => {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== 'del') {
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (lines[i]?.kind === 'del') dels.push(lines[i++]!);
    const adds: DiffLine[] = [];
    while (lines[i]?.kind === 'add') adds.push(lines[i++]!);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const a = dels[k]!.text;
      const b = adds[k]!.text;
      let p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      let s = 0;
      while (
        s < a.length - p &&
        s < b.length - p &&
        a[a.length - 1 - s] === b[b.length - 1 - s]
      )
        s++;
      // No shared prefix or suffix: the whole line changed, so the line
      // background says it all.
      if (p + s === 0) continue;
      dels[k]!.change = [p, a.length - s];
      adds[k]!.change = [p, b.length - s];
    }
  }
};

export type Lang = 'ts' | 'plain';

export const langOf = (path: string): Lang =>
  /\.(m?[jt]sx?|cjs|cts|mts)$/.test(path) ? 'ts' : 'plain';

const KEYWORDS = new Set(
  'import export from const let var function return if else for while do switch case break continue new typeof instanceof in of as type interface extends implements class async await throw try catch finally default void keyof readonly satisfies'.split(
    ' '
  )
);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this']);
const TOKEN_RE =
  /(\/\/.*$)|('(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|`(?:\\.|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(=>|[=!<>]=?=?|&&|\|\||\?\?|\?\.|[+\-*/%])|([^\s])/g;

export type TokenClass =
  | ''
  | 'kw'
  | 'str'
  | 'num'
  | 'lit'
  | 'const'
  | 'fn'
  | 'type'
  | 'prop'
  | 'id'
  | 'op'
  | 'pun'
  | 'com';
export type Token = { text: string; cls: TokenClass };

const identClass = (ident: string, before: string, after: string) => {
  if (KEYWORDS.has(ident)) return 'kw';
  if (LITERALS.has(ident)) return 'lit';
  const capital = /^[A-Z]/.test(ident);
  const shouting = /^[A-Z0-9_]+$/.test(ident);
  if (after.startsWith('(') || after.startsWith('<'))
    return capital ? 'type' : 'fn';
  if (capital && !shouting) return 'type';
  if (before.endsWith('.')) return 'prop';
  if (shouting && ident.length > 1) return 'const';
  return 'id';
};

export const tokenize = (text: string, lang: Lang): Token[] => {
  if (lang !== 'ts') return [{ text, cls: '' }];
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const [t, comment, str, num, ident, space, op] = m;
    let cls: TokenClass = 'pun';
    if (comment) cls = 'com';
    else if (str) cls = 'str';
    else if (num) cls = 'num';
    else if (ident)
      cls = identClass(
        ident,
        text.slice(0, m.index).trimEnd(),
        text.slice(m.index + t.length).trimStart()
      );
    else if (space) cls = '';
    else if (op) cls = 'op';
    out.push({ text: t, cls });
  }
  return out;
};

export type Span = Token & { changed: boolean };

// The line's tokens, cut at the change boundaries so the change highlight
// sits on top of the syntax colours.
export const lineSpans = (line: DiffLine, lang: Lang): Span[] => {
  const tokens = tokenize(line.text, lang);
  if (!line.change) return tokens.map((t) => ({ ...t, changed: false }));
  const [cs, ce] = line.change;
  const spans: Span[] = [];
  let pos = 0;
  for (const t of tokens) {
    const end = pos + t.text.length;
    const cuts = [pos, ...[cs, ce].filter((c) => c > pos && c < end), end];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]!;
      const b = cuts[k + 1]!;
      spans.push({
        text: t.text.slice(a - pos, b - pos),
        cls: t.cls,
        changed: a >= cs && b <= ce,
      });
    }
    pos = end;
  }
  return spans;
};
