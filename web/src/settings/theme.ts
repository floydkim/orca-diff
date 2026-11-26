import markdownDark from 'github-markdown-css/github-markdown-dark.css?inline';
import markdownLight from 'github-markdown-css/github-markdown-light.css?inline';
import highlightDark from 'highlight.js/styles/github-dark.css?inline';
import highlightLight from 'highlight.js/styles/github.css?inline';
import { create } from 'zustand';
import { monaco, setSyntaxTheme } from '../monaco/setup.ts';
import { getPref, setPref } from '../prefs.ts';

type Theme = 'light' | 'dark';
export type ThemeMode = 'system' | Theme;

const MARKDOWN_CSS: Record<Theme, string> = { light: markdownLight + highlightLight, dark: markdownDark + highlightDark };
const markdownStyle = document.head.appendChild(document.createElement('style'));

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  markdownStyle.textContent = MARKDOWN_CSS[theme];
  setSyntaxTheme(theme);
  monaco.editor.setTheme(`github-${theme}`);
}

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const applyMode = (mode: ThemeMode) => apply(mode === 'system' ? (systemDark.matches ? 'dark' : 'light') : mode);

export const useThemeMode = create<{ mode: ThemeMode; setMode(mode: ThemeMode): void }>((set) => ({
  mode: 'system',
  setMode: (mode) => {
    set({ mode });
    setPref('theme', mode, { immediate: true });
    applyMode(mode);
  },
}));

// 설정을 읽기 전에도 화면이 비지 않도록 우선 시스템 테마로 칠해 두고, 설정을 읽은 뒤 loadThemeMode로 바꾼다
applyMode('system');
systemDark.addEventListener('change', () => applyMode(useThemeMode.getState().mode));

export function loadThemeMode(): void {
  const saved = getPref<unknown>('theme', 'system');
  const mode: ThemeMode = saved === 'light' || saved === 'dark' ? saved : 'system';
  useThemeMode.setState({ mode });
  applyMode(mode);
}
