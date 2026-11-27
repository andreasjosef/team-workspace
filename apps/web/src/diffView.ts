export type DiffLang =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'css'
  | 'markdown'
  | 'yaml'
  | 'shellscript'
  | 'text';

export type DiffLine = {
  kind: 'hunk' | 'add' | 'del' | 'context' | 'meta';
  prefix: '+' | '-' | ' ' | '';
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type DiffFile = {
  path: string;
  status: 'added' | 'deleted' | 'modified';
  lang: DiffLang;
  additions: number;
  deletions: number;
  lines: DiffLine[];
};

export const detectLang = (path: string): DiffLang => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.mts') ||
    lower.endsWith('.cts')
  ) {
    return 'typescript';
  }
  if (lower.endsWith('.jsx')) return 'jsx';
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'javascript';
  }
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shellscript';
  return 'text';
};

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const cleanGitPath = (raw: string) => raw.replace(/^[ab]\//, '');

export const parseDiff = (diff: string): DiffFile[] => {
  if (!diff.trim()) return [];
  const rawLines = diff.replace(/\r\n/g, '\n').split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldNum = 0;
  let newNum = 0;

  const makeFile = (path: string): DiffFile => {
    const file: DiffFile = {
      path,
      status: 'modified',
      lang: detectLang(path),
      additions: 0,
      deletions: 0,
      lines: [],
    };
    files.push(file);
    return file;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    if (i === rawLines.length - 1 && line === '') break;

    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const path = m ? m[2]! : line.slice('diff --git '.length);
      current = makeFile(path);
      continue;
    }

    if (line.startsWith('new file mode ')) {
      if (current) current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      if (current) current.status = 'deleted';
      continue;
    }
    if (line.startsWith('index ') || line.startsWith('similarity index ')) {
      continue;
    }
    if (line.startsWith('--- ')) {
      const target = line.slice(4).trim();
      if (target === '/dev/null' && current) current.status = 'added';
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        if (current) current.status = 'deleted';
      } else {
        const cleaned = cleanGitPath(target);
        if (!current) current = makeFile(cleaned);
        else if (cleaned) {
          current.path = cleaned;
          current.lang = detectLang(cleaned);
        }
      }
      continue;
    }

    if (!current) current = makeFile('patch');

    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      oldNum = Number(hunk[1]);
      newNum = Number(hunk[2]);
      current!.lines.push({
        kind: 'hunk',
        prefix: '',
        text: line,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    if (line.startsWith('+')) {
      current!.additions++;
      current!.lines.push({
        kind: 'add',
        prefix: '+',
        text: line.slice(1),
        oldLine: null,
        newLine: newNum++,
      });
      continue;
    }

    if (line.startsWith('-')) {
      current!.deletions++;
      current!.lines.push({
        kind: 'del',
        prefix: '-',
        text: line.slice(1),
        oldLine: oldNum++,
        newLine: null,
      });
      continue;
    }

    if (line.startsWith('\\')) {
      current!.lines.push({
        kind: 'meta',
        prefix: '',
        text: line,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    current!.lines.push({
      kind: 'context',
      prefix: ' ',
      text: line.startsWith(' ') ? line.slice(1) : line,
      oldLine: oldNum++,
      newLine: newNum++,
    });
  }

  return files;
};

export type SplitRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'pair'; left: DiffLine | null; right: DiffLine | null };

// Pairs consecutive deletion + addition blocks side by side for Split view.
export const pairSplitRows = (lines: DiffLine[]): SplitRow[] => {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === 'hunk') {
      rows.push({ kind: 'hunk', text: line.text });
      i++;
      continue;
    }
    if (line.kind === 'context' || line.kind === 'meta') {
      rows.push({ kind: 'pair', left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === 'del') {
      dels.push(lines[i]!);
      i++;
    }
    while (i < lines.length && lines[i]!.kind === 'add') {
      adds.push(lines[i]!);
      i++;
    }
    const count = Math.max(dels.length, adds.length);
    for (let k = 0; k < count; k++) {
      rows.push({
        kind: 'pair',
        left: dels[k] ?? null,
        right: adds[k] ?? null,
      });
    }
  }
  return rows;
};
