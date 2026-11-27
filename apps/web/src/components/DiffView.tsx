import { useEffect, useMemo, useState } from 'react';
import type { HighlighterCore, ThemedToken } from 'shiki/core';
import {
  pairSplitRows,
  parseDiff,
  type DiffFile,
  type DiffLine,
} from '../diffView.ts';
import {
  DIFF_THEMES,
  getDiffHighlighter,
  tokenizeDiffLines,
  type DiffThemeId,
} from '../shiki.ts';

type DiffLayout = 'unified' | 'split' | 'compact';

const DIFF_LAYOUTS: { id: DiffLayout; label: string }[] = [
  { id: 'unified', label: 'Unified' },
  { id: 'split', label: 'Split' },
  { id: 'compact', label: 'Compact' },
];

const THEME_KEY = 'tw.diffTheme';
const LAYOUT_KEY = 'tw.diffLayout';

const readSavedTheme = (): DiffThemeId => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (DIFF_THEMES.some((t) => t.id === saved)) return saved as DiffThemeId;
  } catch {
    // Ignore storage errors (private mode, SSR, tests).
  }
  return 'vesper';
};

const readSavedLayout = (): DiffLayout => {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (DIFF_LAYOUTS.some((l) => l.id === saved)) return saved as DiffLayout;
  } catch {
    // Ignore storage errors.
  }
  return 'unified';
};

const CodeTokens = ({
  text,
  tokens,
}: {
  text: string;
  tokens: ThemedToken[] | undefined;
}) => (
  <span className="diff-text">
    {tokens && tokens.length > 0
      ? tokens.map((tok, ti) => (
          <span key={ti} style={tok.color ? { color: tok.color } : undefined}>
            {tok.content}
          </span>
        ))
      : text || ' '}
  </span>
);

const DiffFileCard = ({
  file,
  theme,
  layout,
  highlighter,
}: {
  file: DiffFile;
  theme: DiffThemeId;
  layout: DiffLayout;
  highlighter: HighlighterCore | null;
}) => {
  const tokensByLine = useMemo(() => {
    if (!highlighter || theme === 'plain' || file.lang === 'text') return null;
    const codeLines: DiffLine[] = [];
    const codeTexts: string[] = [];
    for (const line of file.lines) {
      if (
        line.kind === 'add' ||
        line.kind === 'del' ||
        line.kind === 'context'
      ) {
        codeLines.push(line);
        codeTexts.push(line.text);
      }
    }
    const tokenized = tokenizeDiffLines(
      highlighter,
      codeTexts,
      file.lang,
      theme
    );
    if (!tokenized) return null;
    const map = new Map<DiffLine, ThemedToken[]>();
    codeLines.forEach((line, i) => {
      map.set(line, tokenized[i] ?? []);
    });
    return map;
  }, [file, highlighter, theme]);

  const splitRows = useMemo(
    () => (layout === 'split' ? pairSplitRows(file.lines) : []),
    [file.lines, layout]
  );

  const compactLines = useMemo(() => {
    if (layout !== 'compact') return [];
    const out: (DiffLine | { kind: 'gap' })[] = [];
    let sawChange = false;
    let pendingGap = false;
    for (const line of file.lines) {
      if (line.kind === 'add' || line.kind === 'del') {
        if (pendingGap && sawChange) out.push({ kind: 'gap' });
        pendingGap = false;
        sawChange = true;
        out.push(line);
      } else if (sawChange) {
        pendingGap = true;
      }
    }
    return out;
  }, [file.lines, layout]);

  return (
    <div className="diff-file-card">
      <div className="diff-file-head">
        <div className="diff-file-title">
          <span className="diff-file-path">{file.path}</span>
          {file.status === 'added' && (
            <span className="diff-status diff-status-add">new</span>
          )}
          {file.status === 'deleted' && (
            <span className="diff-status diff-status-del">deleted</span>
          )}
        </div>
        <div className="diff-file-stats">
          {file.additions > 0 && (
            <span className="diff-stat-add">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="diff-stat-del">-{file.deletions}</span>
          )}
        </div>
      </div>

      {layout === 'split' ? (
        <div
          className="diff-code diff-code-split"
          role="region"
          aria-label={file.path}
        >
          {splitRows.map((row, idx) => {
            if (row.kind === 'hunk') {
              return (
                <div key={idx} className="diff-split-hunk">
                  {row.text}
                </div>
              );
            }
            const { left, right } = row;
            return (
              <div key={idx} className="diff-split-row">
                <div
                  className={`diff-split-cell ${
                    left ? `diff-row-${left.kind}` : 'diff-split-empty'
                  }`}
                >
                  <span className="diff-ln" aria-hidden="true">
                    {left?.oldLine ?? ''}
                  </span>
                  <span className="diff-sign" aria-hidden="true">
                    {left?.prefix ?? ''}
                  </span>
                  {left ? (
                    <CodeTokens
                      text={left.text}
                      tokens={tokensByLine?.get(left)}
                    />
                  ) : (
                    <span className="diff-text"> </span>
                  )}
                </div>
                <div
                  className={`diff-split-cell ${
                    right ? `diff-row-${right.kind}` : 'diff-split-empty'
                  }`}
                >
                  <span className="diff-ln" aria-hidden="true">
                    {right?.newLine ?? ''}
                  </span>
                  <span className="diff-sign" aria-hidden="true">
                    {right?.prefix ?? ''}
                  </span>
                  {right ? (
                    <CodeTokens
                      text={right.text}
                      tokens={tokensByLine?.get(right)}
                    />
                  ) : (
                    <span className="diff-text"> </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : layout === 'compact' ? (
        <div className="diff-code" role="region" aria-label={file.path}>
          {compactLines.map((item, idx) => {
            if (item.kind === 'gap') {
              return (
                <div key={idx} className="diff-compact-gap" aria-hidden="true">
                  ···
                </div>
              );
            }
            return (
              <div key={idx} className={`diff-row diff-row-${item.kind}`}>
                <span className="diff-ln" aria-hidden="true">
                  {item.oldLine ?? ''}
                </span>
                <span className="diff-ln" aria-hidden="true">
                  {item.newLine ?? ''}
                </span>
                <span className="diff-sign" aria-hidden="true">
                  {item.prefix}
                </span>
                <CodeTokens text={item.text} tokens={tokensByLine?.get(item)} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="diff-code" role="region" aria-label={file.path}>
          {file.lines.map((line, idx) => {
            if (line.kind === 'hunk') {
              return (
                <div key={idx} className="diff-row diff-row-hunk">
                  <span className="diff-ln" aria-hidden="true" />
                  <span className="diff-ln" aria-hidden="true" />
                  <span className="diff-sign" aria-hidden="true" />
                  <span className="diff-text">{line.text}</span>
                </div>
              );
            }
            return (
              <div key={idx} className={`diff-row diff-row-${line.kind}`}>
                <span className="diff-ln" aria-hidden="true">
                  {line.oldLine ?? ''}
                </span>
                <span className="diff-ln" aria-hidden="true">
                  {line.newLine ?? ''}
                </span>
                <span className="diff-sign" aria-hidden="true">
                  {line.prefix}
                </span>
                <CodeTokens text={line.text} tokens={tokensByLine?.get(line)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const DiffView = ({ diff }: { diff: string }) => {
  const [theme, setTheme] = useState<DiffThemeId>(readSavedTheme);
  const [layout, setLayout] = useState<DiffLayout>(readSavedLayout);
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null);
  const files = useMemo(() => parseDiff(diff), [diff]);

  useEffect(() => {
    if (theme === 'plain' || highlighter) return;
    let active = true;
    void getDiffHighlighter().then((h) => {
      if (active) setHighlighter(h);
    });
    return () => {
      active = false;
    };
  }, [theme, highlighter]);

  const pickTheme = (next: DiffThemeId) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  };

  const pickLayout = (next: DiffLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  };

  if (files.length === 0) {
    return (
      <div className="diff-empty muted">{diff ? diff : 'No changes.'}</div>
    );
  }

  const totalAdds = files.reduce((n, f) => n + f.additions, 0);
  const totalDels = files.reduce((n, f) => n + f.deletions, 0);

  return (
    <div className={`diff-wrap ${theme === 'plain' ? 'diff-plain' : ''}`}>
      <div className="diff-toolbar">
        <div className="diff-summary">
          <span>
            {files.length} file{files.length === 1 ? '' : 's'}
          </span>
          {totalAdds > 0 && <span className="diff-stat-add">+{totalAdds}</span>}
          {totalDels > 0 && <span className="diff-stat-del">-{totalDels}</span>}
        </div>
        <div className="diff-controls">
          <div
            className="diff-theme-picker"
            role="group"
            aria-label="Diff layout"
          >
            {DIFF_LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`diff-theme-btn ${layout === l.id ? 'active' : ''}`}
                aria-pressed={layout === l.id}
                onClick={() => pickLayout(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div
            className="diff-theme-picker"
            role="group"
            aria-label="Diff syntax theme"
          >
            {DIFF_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`diff-theme-btn ${theme === t.id ? 'active' : ''}`}
                aria-pressed={theme === t.id}
                onClick={() => pickTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="diff-files">
        {files.map((file) => (
          <DiffFileCard
            key={file.path}
            file={file}
            theme={theme}
            layout={layout}
            highlighter={highlighter}
          />
        ))}
      </div>
    </div>
  );
};
