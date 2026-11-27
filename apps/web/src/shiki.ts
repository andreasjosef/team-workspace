import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';
import type { DiffLang } from './diffView.ts';

export type DiffThemeId =
  | 'vesper'
  | 'gruvbox-dark-medium'
  | 'github-dark-default'
  | 'tokyo-night'
  | 'plain';

export const DIFF_THEMES: { id: DiffThemeId; label: string }[] = [
  { id: 'vesper', label: 'Vesper' },
  { id: 'gruvbox-dark-medium', label: 'Gruvbox' },
  { id: 'github-dark-default', label: 'GitHub Dark' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'plain', label: 'Plain' },
];

type ShikiThemeId = Exclude<DiffThemeId, 'plain'>;

const SHIKI_THEMES: ShikiThemeId[] = [
  'vesper',
  'gruvbox-dark-medium',
  'github-dark-default',
  'tokyo-night',
];

const SHIKI_LANGS: Exclude<DiffLang, 'text'>[] = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'css',
  'markdown',
  'yaml',
  'shellscript',
];

let highlighterPromise: Promise<HighlighterCore> | null = null;

export const getDiffHighlighter = (): Promise<HighlighterCore> => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: SHIKI_THEMES.map((id) => bundledThemes[id]),
      langs: SHIKI_LANGS.map((id) => bundledLanguages[id]),
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
};

export const tokenizeDiffLines = (
  highlighter: HighlighterCore,
  lines: string[],
  lang: DiffLang,
  theme: ShikiThemeId
): ThemedToken[][] | null => {
  if (lang === 'text' || lines.length === 0) return null;
  try {
    return highlighter.codeToTokens(lines.join('\n'), { lang, theme }).tokens;
  } catch {
    return null;
  }
};
