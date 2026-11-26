import type * as Monaco from 'monaco-editor';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import jsx from 'shiki/langs/jsx.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import { EncodedTokenMetadata, INITIAL, type StateStack } from 'shiki/textmate';
import githubDark from 'shiki/themes/github-dark-default.mjs';
import githubLight from 'shiki/themes/github-light-default.mjs';
// 문법 데우기용 예제(JSX·타입·문자열 등이 고루 들어 있는 앱 파일)
import warmSample from '../nav/UsagesPopup.tsx?raw';

// Monaco 기본 TS/JS 구문 강조 대신 VS Code의 TextMate 문법과 GitHub 공식 테마(Shiki)로 칠한다.
// 토큰 이름에 색을 그대로 담고(shiki.<hex>), Monaco 테마에는 그 이름마다 같은 색 규칙을 넣는다.
// 그래서 diff 배경 등 기존 Monaco 테마 설정은 그대로 두고 글자 색만 Shiki를 따른다.

type Mode = 'light' | 'dark';
const THEMES = { light: githubLight, dark: githubDark };
// .ts와 .tsx 모두 Monaco에서는 typescript라서 JSX까지 아는 tsx 문법을 쓴다
const GRAMMARS = { typescript: 'tsx', javascript: 'jsx' } as const;

const hex = (color: string) => color.replace('#', '').slice(0, 6).toLowerCase();

// Monaco 테마에 넣을 규칙: 두 테마에서 쓰는 모든 글자 색
export function shikiThemeRules(): Monaco.editor.ITokenThemeRule[] {
  const colors = new Set<string>();
  for (const theme of Object.values(THEMES)) {
    const fg = theme.colors?.['editor.foreground'];
    if (fg) colors.add(hex(fg));
    for (const { settings } of theme.tokenColors ?? []) if (settings.foreground) colors.add(hex(settings.foreground));
  }
  return [...colors].map((c) => ({ token: `shiki.${c}`, foreground: c }));
}

// 문법 정규식은 처음 쓸 때 컴파일되어 첫 파일이 몇 배 느리다(800줄 기준 약 0.4초 → 0.1초).
// 브라우저가 한가할 때 예제를 몇 줄씩 미리 칠해 컴파일을 끝내 둔다.
function warmUp(grammar: { tokenizeLine2(line: string, stack: StateStack, timeLimit?: number): { ruleStack: StateStack } }) {
  const lines = warmSample.split('\n');
  let i = 0;
  let stack = INITIAL;
  const step = (deadline: IdleDeadline) => {
    while (i < lines.length && deadline.timeRemaining() > 2) stack = grammar.tokenizeLine2(lines[i++], stack, 500).ruleStack;
    if (i < lines.length) requestIdleCallback(step);
  };
  requestIdleCallback(step);
}

class State implements Monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() { return this; }
  equals(other: Monaco.languages.IState) { return other instanceof State && other.stack === this.stack; }
}

export function installShiki(monaco: typeof Monaco): (mode: Mode) => void {
  let mode: Mode = 'light';
  let colorMap: string[] = [];
  const ready = createHighlighterCore({ themes: [githubLight, githubDark], langs: [tsx, jsx], engine: createJavaScriptRegexEngine() }).then((h) => {
    colorMap = h.setTheme(THEMES[mode].name!).colorMap;
    warmUp(h.getLanguage('tsx'));
    return h;
  });

  const provider = (h: Awaited<typeof ready>, grammar: string): Monaco.languages.TokensProvider => ({
    getInitialState: () => new State(INITIAL),
    tokenize(line, state) {
      const s = state as State;
      // 아주 긴 줄(번들 등)은 칠하지 않는다
      if (line.length > 20000) return { endState: s, tokens: [{ startIndex: 0, scopes: '' }] };
      const result = h.getLanguage(grammar).tokenizeLine2(line, s.stack, 500);
      const tokens: Monaco.languages.IToken[] = [];
      for (let i = 0; i < result.tokens.length; i += 2) {
        const color = colorMap[EncodedTokenMetadata.getForeground(result.tokens[i + 1])];
        tokens.push({ startIndex: result.tokens[i], scopes: color ? `shiki.${hex(color)}` : '' });
      }
      return { endState: new State(result.ruleStack), tokens };
    },
  });

  for (const [lang, grammar] of Object.entries(GRAMMARS)) {
    monaco.languages.registerTokensProviderFactory(lang, { create: async () => provider(await ready, grammar) });
  }

  // 토큰에 색이 박혀 있으므로 테마가 바뀌면 그 테마 색으로 다시 토큰화한다
  return (next) => {
    if (next === mode) return;
    mode = next;
    void ready.then((h) => {
      colorMap = h.setTheme(THEMES[mode].name!).colorMap;
      for (const [lang, grammar] of Object.entries(GRAMMARS)) monaco.languages.setTokensProvider(lang, provider(h, grammar));
    });
  };
}
