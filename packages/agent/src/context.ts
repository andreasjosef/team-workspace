import type { ProductDoc } from '@app/shared';

// The context builder: which files and decisions the agent sees for a task.
// Keyword and path matching only: good enough for a demo repo, and easy to
// explain on the receipt ("these went into the prompt, and here's why").

// A flow-style list as YAML writes it: ["a", 'b', c]. Anything else is [].
export const parseList = (raw: string): string[] => {
  const m = /^\[(.*)\]$/.exec(raw.trim());
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((item) => item.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter((item) => item && !/['"[\]]/.test(item));
};

// A tiny front-matter reader for decision files: `key: value` lines, with
// `files` as a flow-style list. Anything it doesn't understand is ignored.
// CRLF files (saved on Windows) read the same as LF ones.
export const parseDoc = (path: string, text: string): ProductDoc => {
  const raw = text.replace(/\r\n/g, '\n');
  const isDecision = path.startsWith('decisions/');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const meta: Record<string, string> = {};
  for (const line of fm?.[1]?.split('\n') ?? []) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]!] = m[2]!.trim();
  }
  const body = fm ? raw.slice(fm[0].length) : raw;
  const files = parseList(meta.files ?? '');
  const heading = /^#\s+(.+)$/m.exec(body)?.[1];
  return {
    path,
    kind: isDecision ? 'decision' : 'doc',
    id: meta.id ?? path,
    title: meta.title ?? heading ?? path,
    date: meta.date ?? null,
    by: meta.by ?? null,
    files,
    body: body.trim(),
  };
};

const STOP = new Set(
  'a an and are at be but by can do does for from has have i in is it its my not of on or our so that the their this to was we when with you your'.split(
    ' '
  )
);

export const keywords = (text: string) => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  ),
];

// Crude stemming, so "codes" finds "code" and "discounts" finds "discount".
const stem = (w: string) => w.replace(/(ing|es|s)$/, '');

const score = (haystack: string, words: string[]) => {
  const h = haystack.toLowerCase();
  return words.reduce((n, w) => n + (h.includes(stem(w)) ? 1 : 0), 0);
};

// Source files ranked by how many task keywords they mention, path counting
// double, keeping only those within half of the best score. Tests and config are left to the agent to ask for.
export const rankFiles = (
  files: { path: string; content: string }[],
  text: string,
  max = 4
): string[] => {
  const words = keywords(text);
  const scored = files.map((f) => ({
    path: f.path,
    s: score(f.path, words) * 2 + score(f.content, words),
  }));
  // Only files close to the best match: one shared word is noise.
  const best = Math.max(0, ...scored.map((f) => f.s));
  const floor = Math.max(2, best / 2);
  return scored
    .filter((f) => f.s >= floor)
    .sort((a, b) => b.s - a.s || a.path.localeCompare(b.path))
    .slice(0, max)
    .map((f) => f.path);
};

// Decisions linked to any chosen file, then decisions whose title matches the
// task, then nothing else. Linked ones come first: they explain the code.
export const matchDecisions = (
  docs: ProductDoc[],
  files: string[],
  text: string,
  max = 3
): ProductDoc[] => {
  const decisions = docs.filter((d) => d.kind === 'decision');
  const linked = decisions.filter((d) =>
    d.files.some((f) => files.includes(f))
  );
  const words = keywords(text);
  const byTitle = decisions
    .filter((d) => !linked.includes(d) && score(d.title, words) >= 2)
    .sort((a, b) => score(b.title, words) - score(a.title, words));
  return [...linked, ...byTitle].slice(0, max);
};
