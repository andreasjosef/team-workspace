import { useEffect, useMemo, useState } from 'react';
import type { HighlighterCore, ThemedToken } from 'shiki/core';
import { parseDiff, type DiffFile } from '../diffView.ts';
import {
  DIFF_THEMES,
  getDiffHighlighter,
  tokenizeDiffLines,
  type DiffThemeId,
} from '../shiki.ts';

const THEME_KEY = 'tw.diffTheme';

const readSavedTheme = (): DiffThemeId => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (DIFF_THEMES.some((t) => t.id === saved)) return saved as DiffThemeId;
  } catch {
    // Ignore storage errors (private mode, SSR, tests).
  }
  return 'vesper';
};

const DiffFileCard = ({
  file,
  theme,
  highlighter,
}: {
  file: DiffFile;
  theme: DiffThemeId;
  highlighter: HighlighterCore | null;
}) => {
  const tokensByIndex = useMemo(() => {
    if (!highlighter || theme === 'plain' || file.lang === 'text') return null;
    const codeIndices: number[] = [];
    const codeTexts: string[] = [];
    file.lines.forEach((line, idx) => {
      if (
        line.kind === 'add' ||
        line.kind === 'del' ||
        line.kind === 'context'
      ) {
        codeIndices.push(idx);
        codeTexts.push(line.text);
      }
    });
    const tokenized = tokenizeDiffLines(
      highlighter,
      codeTexts,
      file.lang,
      theme
    );
    if (!tokenized) return null;
    const map = new Map<number, ThemedToken[]>();
    codeIndices.forEach((lineIdx, i) => {
      map.set(lineIdx, tokenized[i] ?? []);
    });
    return map;
  }, [file, highlighter, theme]);

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

          const tokens = tokensByIndex?.get(idx);
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
              <span className="diff-text">
                {tokens && tokens.length > 0
                  ? tokens.map((tok, ti) => (
                      <span
                        key={ti}
                        style={tok.color ? { color: tok.color } : undefined}
                      >
                        {tok.content}
                      </span>
                    ))
                  : line.text || ' '}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const DiffView = ({ diff }: { diff: string }) => {
  const [theme, setTheme] = useState<DiffThemeId>(readSavedTheme);
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

      <div className="diff-files">
        {files.map((file) => (
          <DiffFileCard
            key={file.path}
            file={file}
            theme={theme}
            highlighter={highlighter}
          />
        ))}
      </div>
    </div>
  );
};
