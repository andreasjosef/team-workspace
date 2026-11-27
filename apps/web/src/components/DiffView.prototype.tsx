// PROTOTYPE, throwaway. Question: what should the Changes tab look like,
// with syntax highlighting, closer to Linear's diff view?
// Variants via `?variant=` on any task page (Changes tab) or on the preview
// route `/cs/prototype/diff`, which renders SAMPLE_DIFF:
//   current: today's DiffView, for comparison
//   A: stacked file cards, unified, word-level change highlight
//   B: stacked file cards, split (old | new)
//   C: file list on the left, one file at a time on the right
import { Fragment, useState } from 'react';
import './DiffView.prototype.css';

// ---------- parsing ----------

type Line = {
  kind: 'ctx' | 'add' | 'del';
  oldNo?: number;
  newNo?: number;
  text: string;
  change?: [number, number];
};
type Hunk = { header: string; context: string; lines: Line[] };
type FileDiff = {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  hunks: Hunk[];
  adds: number;
  dels: number;
};

const parseDiff = (diff: string): FileDiff[] => {
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
    if (raw.startsWith('new file')) file.status = 'added';
    else if (raw.startsWith('deleted file')) file.status = 'deleted';
    else if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(raw);
      oldNo = Number(m?.[1] ?? 1);
      newNo = Number(m?.[2] ?? 1);
      hunk = { header: raw, context: m?.[3] ?? '', lines: [] };
      file.hunks.push(hunk);
    } else if (hunk && !raw.startsWith('\\')) {
      if (raw.startsWith('+++') || raw.startsWith('---')) continue;
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
  }
  // Drop trailing empty context lines produced by the final newline.
  for (const f of files)
    for (const h of f.hunks)
      while (h.lines.at(-1)?.kind === 'ctx' && h.lines.at(-1)?.text === '')
        h.lines.pop();
  for (const f of files) for (const h of f.hunks) markWordChanges(h.lines);
  return files;
};

// Pair each run of deletions with the additions right after it, and mark
// the span between the common prefix and suffix as the changed part.
const markWordChanges = (lines: Line[]) => {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== 'del') {
      i++;
      continue;
    }
    const dels: Line[] = [];
    while (lines[i]?.kind === 'del') dels.push(lines[i++]!);
    const adds: Line[] = [];
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
      if (p + s === 0) continue;
      dels[k]!.change = [p, a.length - s];
      adds[k]!.change = [p, b.length - s];
    }
  }
};

// ---------- syntax highlighting (tiny TS tokenizer, good enough) ----------

const KEYWORDS = new Set(
  'import export from const let var function return if else for while do switch case break continue new typeof instanceof in of as type interface extends implements class async await throw try catch finally default void keyof readonly satisfies'.split(
    ' '
  )
);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this']);
const TOKEN_RE =
  /(\/\/.*$)|('(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|`(?:\\.|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(=>|[=!<>]=?=?|&&|\|\||\?\?|\?\.|[+\-*/%])|([^\s])/g;

type Tok = { text: string; cls: string };

const tokenize = (text: string, lang: string): Tok[] => {
  if (lang !== 'ts') return [{ text, cls: '' }];
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const [t, comment, str, num, ident, , op] = m;
    let cls = 'pun';
    if (comment) cls = 'com';
    else if (str) cls = 'str';
    else if (num) cls = 'num';
    else if (op) cls = 'op';
    else if (ident) {
      const before = text.slice(0, m.index).trimEnd();
      const after = text.slice(m.index + t.length).trimStart();
      if (KEYWORDS.has(ident)) cls = 'kw';
      else if (LITERALS.has(ident)) cls = 'lit';
      else if (after.startsWith('(') || after.startsWith('<'))
        cls = /^[A-Z]/.test(ident) ? 'type' : 'fn';
      else if (/^[A-Z]/.test(ident) && !/^[A-Z0-9_]+$/.test(ident))
        cls = 'type';
      else if (before.endsWith('.')) cls = 'prop';
      else if (/^[A-Z0-9_]+$/.test(ident) && ident.length > 1) cls = 'const';
      else cls = 'id';
    } else if (/^\s+$/.test(t)) cls = '';
    out.push({ text: t, cls });
  }
  return out;
};

const langOf = (path: string) =>
  /\.(m?[jt]sx?|cjs|cts|mts)$/.test(path) ? 'ts' : 'plain';

const Code = ({ line, lang }: { line: Line; lang: string }) => {
  const toks = tokenize(line.text, lang);
  if (!line.change) {
    return (
      <>
        {toks.map((t, i) => (
          <span key={i} className={t.cls ? `tk-${t.cls}` : undefined}>
            {t.text}
          </span>
        ))}
        {line.text === '' && ' '}
      </>
    );
  }
  // Split tokens at the change boundaries so the word highlight sits on top
  // of the syntax colours.
  const [cs, ce] = line.change;
  const parts: { text: string; cls: string; chg: boolean }[] = [];
  let pos = 0;
  for (const t of toks) {
    const end = pos + t.text.length;
    const cuts = [pos, ...[cs, ce].filter((c) => c > pos && c < end), end];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]!;
      const b = cuts[k + 1]!;
      parts.push({
        text: t.text.slice(a - pos, b - pos),
        cls: t.cls,
        chg: a >= cs && b <= ce,
      });
    }
    pos = end;
  }
  return (
    <>
      {parts.map((p, i) => (
        <span
          key={i}
          className={
            [p.cls && `tk-${p.cls}`, p.chg && 'chg']
              .filter(Boolean)
              .join(' ') || undefined
          }
        >
          {p.text}
        </span>
      ))}
    </>
  );
};

// ---------- shared bits ----------

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    className={`lin-chev ${open ? 'open' : ''}`}
    width="12"
    height="12"
    viewBox="0 0 16 16"
    aria-hidden
  >
    <path
      d="M6 4l4 4-4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
    <path
      d="M4 1.75h5.25L12.5 5v9.25H4z M9 1.75V5.25h3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

const Path = ({ path }: { path: string }) => {
  const i = path.lastIndexOf('/');
  return (
    <span className="lin-path">
      <span className="lin-dir">{path.slice(0, i + 1)}</span>
      <span className="lin-name">{path.slice(i + 1)}</span>
    </span>
  );
};

const Counts = ({ adds, dels }: { adds: number; dels: number }) => (
  <span className="lin-counts">
    {adds > 0 && <span className="lin-plus">+{adds}</span>}
    {dels > 0 && <span className="lin-minus">−{dels}</span>}
  </span>
);

const Summary = ({ files }: { files: FileDiff[] }) => {
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const dels = files.reduce((n, f) => n + f.dels, 0);
  return (
    <div className="lin-summary">
      <span>
        {files.length} {files.length === 1 ? 'file' : 'files'} changed
      </span>
      <Counts adds={adds} dels={dels} />
    </div>
  );
};

const HunkRow = ({ hunk, cols }: { hunk: Hunk; cols: number }) => (
  <tr className="lin-hunk">
    <td colSpan={cols}>
      <span className="lin-hunk-range">{hunk.header.split(' @@')[0]} @@</span>
      {hunk.context && (
        <span className="lin-hunk-ctx">
          <Code line={{ kind: 'ctx', text: hunk.context }} lang="ts" />
        </span>
      )}
    </td>
  </tr>
);

const UnifiedTable = ({ file }: { file: FileDiff }) => {
  const lang = langOf(file.path);
  return (
    <table className="lin-code">
      <tbody>
        {file.hunks.map((h, hi) => (
          <Fragment key={hi}>
            <HunkRow hunk={h} cols={4} />
            {h.lines.map((l, i) => (
              <tr key={i} className={`lin-row ${l.kind}`}>
                <td className="lin-no">{l.oldNo ?? ''}</td>
                <td className="lin-no">{l.newNo ?? ''}</td>
                <td className="lin-sign">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
                </td>
                <td className="lin-text">
                  <Code line={l} lang={lang} />
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
};

const StatusBadge = ({ status }: { status: FileDiff['status'] }) =>
  status === 'modified' ? null : (
    <span className={`lin-badge ${status}`}>
      {status === 'added' ? 'New' : 'Deleted'}
    </span>
  );

const FileCard = ({
  file,
  children,
}: {
  file: FileDiff;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="lin-file">
      <button className="lin-file-head" onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <FileIcon />
        <Path path={file.path} />
        <StatusBadge status={file.status} />
        <Counts adds={file.adds} dels={file.dels} />
      </button>
      {open && <div className="lin-file-body">{children}</div>}
    </section>
  );
};

// ---------- variants ----------

const VariantA = ({ files }: { files: FileDiff[] }) => (
  <div className="lin lin-a">
    <Summary files={files} />
    {files.map((f) => (
      <FileCard key={f.path} file={f}>
        <UnifiedTable file={f} />
      </FileCard>
    ))}
  </div>
);

type SplitRow =
  { type: 'line'; left?: Line; right?: Line } | { type: 'hunk'; hunk: Hunk };

const splitRows = (file: FileDiff): SplitRow[] => {
  const rows: SplitRow[] = [];
  for (const h of file.hunks) {
    rows.push({ type: 'hunk', hunk: h });
    let i = 0;
    while (i < h.lines.length) {
      const l = h.lines[i]!;
      if (l.kind === 'ctx') {
        rows.push({ type: 'line', left: l, right: l });
        i++;
        continue;
      }
      const dels: Line[] = [];
      while (h.lines[i]?.kind === 'del') dels.push(h.lines[i++]!);
      const adds: Line[] = [];
      while (h.lines[i]?.kind === 'add') adds.push(h.lines[i++]!);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++)
        rows.push({ type: 'line', left: dels[k], right: adds[k] });
    }
  }
  return rows;
};

const Half = ({
  line,
  side,
  lang,
}: {
  line?: Line;
  side: 'old' | 'new';
  lang: string;
}) => {
  if (!line)
    return (
      <>
        <td className="lin-no empty" />
        <td className="lin-text empty" />
      </>
    );
  const kind = line.kind;
  return (
    <>
      <td className={`lin-no ${kind}`}>
        {side === 'old' ? line.oldNo : line.newNo}
      </td>
      <td className={`lin-text ${kind}`}>
        <Code line={line} lang={lang} />
      </td>
    </>
  );
};

const VariantB = ({ files }: { files: FileDiff[] }) => (
  <div className="lin lin-b">
    <Summary files={files} />
    {files.map((f) => (
      <FileCard key={f.path} file={f}>
        <table className="lin-code lin-split">
          <colgroup>
            <col className="c-no" />
            <col />
            <col className="c-no" />
            <col />
          </colgroup>
          <tbody>
            {splitRows(f).map((r, i) =>
              r.type === 'hunk' ? (
                <HunkRow key={i} hunk={r.hunk} cols={4} />
              ) : (
                <tr key={i} className="lin-row">
                  <Half line={r.left} side="old" lang={langOf(f.path)} />
                  <Half line={r.right} side="new" lang={langOf(f.path)} />
                </tr>
              )
            )}
          </tbody>
        </table>
      </FileCard>
    ))}
  </div>
);

const VariantC = ({ files }: { files: FileDiff[] }) => {
  const [picked, setPicked] = useState(0);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const file = files[Math.min(picked, files.length - 1)];
  if (!file) return null;
  const toggleViewed = () => {
    const next = new Set(viewed);
    if (next.has(file.path)) next.delete(file.path);
    else next.add(file.path);
    setViewed(next);
  };
  return (
    <div className="lin lin-c">
      <aside className="lin-tree">
        <Summary files={files} />
        <ul>
          {files.map((f, i) => (
            <li key={f.path}>
              <button
                className={`lin-tree-item ${i === picked ? 'active' : ''} ${
                  viewed.has(f.path) ? 'viewed' : ''
                }`}
                onClick={() => setPicked(i)}
                title={f.path}
              >
                <FileIcon />
                <span className="lin-tree-name">
                  {f.path.split('/').pop()}
                  <span className="lin-tree-dir">
                    {f.path.split('/').slice(0, -1).join('/')}
                  </span>
                </span>
                <Counts adds={f.adds} dels={f.dels} />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="lin-pane">
        <div className="lin-pane-head">
          <Path path={file.path} />
          <StatusBadge status={file.status} />
          <Counts adds={file.adds} dels={file.dels} />
          <label className="lin-viewed">
            <input
              type="checkbox"
              checked={viewed.has(file.path)}
              onChange={toggleViewed}
            />
            Viewed
          </label>
        </div>
        <UnifiedTable file={file} />
      </div>
    </div>
  );
};

export const DIFF_VARIANTS = ['current', 'A', 'B', 'C'] as const;
export const DIFF_VARIANT_NAMES: Record<string, string> = {
  current: 'Current',
  A: 'Stacked, unified',
  B: 'Stacked, split',
  C: 'File list + one file',
};

export const PrototypeDiff = ({
  diff,
  variant,
}: {
  diff: string;
  variant: string;
}) => {
  const files = parseDiff(diff);
  if (files.length === 0)
    return <div className="lin lin-empty">No changes.</div>;
  if (variant === 'B') return <VariantB files={files} />;
  if (variant === 'C') return <VariantC files={files} />;
  return <VariantA files={files} />;
};

// A plausible agent fix on demo/shop: discount codes typed in lower case.
export const SAMPLE_DIFF = `diff --git a/src/checkout/discount.ts b/src/checkout/discount.ts
index 3f1c2a1..8b0d7e4 100644
--- a/src/checkout/discount.ts
+++ b/src/checkout/discount.ts
@@ -1,13 +1,14 @@
 export type Discount = { code: string; percentOff: number; expires: string };

-// Active codes. Marketing sends these in emails, in upper case.
+// Active codes, keyed in upper case. Marketing sends them in emails and
+// customers type them however they like, so lookups ignore case.
 const CODES: Record<string, Discount> = {
   SUMMER20: { code: 'SUMMER20', percentOff: 20, expires: '2026-12-31' },
   WELCOME10: { code: 'WELCOME10', percentOff: 10, expires: '2027-06-30' },
 };

 export const findDiscount = (input: string, today: string): Discount | null => {
-  const discount = CODES[input.trim()];
+  const discount = CODES[input.trim().toUpperCase()];
   if (!discount || discount.expires < today) return null;
   return discount;
 };
diff --git a/src/checkout/discount.test.ts b/src/checkout/discount.test.ts
index 9a7e112..c41f0b9 100644
--- a/src/checkout/discount.test.ts
+++ b/src/checkout/discount.test.ts
@@ -10,6 +10,10 @@ describe('discount codes', () => {
     expect(findDiscount('  WELCOME10 ', '2026-11-18')?.percentOff).toBe(10);
   });

+  it('matches a code typed in lower case', () => {
+    expect(findDiscount('summer20', '2026-11-18')?.percentOff).toBe(20);
+  });
+
   it('refuses an expired code', () => {
     expect(findDiscount('SUMMER20', '2027-01-01')).toBeNull();
   });
`;
