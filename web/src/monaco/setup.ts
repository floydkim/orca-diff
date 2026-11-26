import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { installShiki, shikiThemeRules } from './shikiTokens.ts';

// diff 계산 등에 쓰는 기본 워커만 둔다. 언어 서비스 워커는 쓰지 않는다.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

// Monaco 내장 TS/JS 언어 서비스(정의·참조·호버·진단 등)는 끄고 구문 강조만 쓴다.
// 탐색은 서버의 tsserver가 담당한다.
const OFF = {
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  diagnostics: false,
  documentRangeFormattingEdits: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
};
monaco.typescript.typescriptDefaults.setModeConfiguration(OFF);
monaco.typescript.javascriptDefaults.setModeConfiguration(OFF);

// TS/JS 구문 강조는 Shiki(TextMate 문법 + GitHub 테마)로 한다
export const setSyntaxTheme = installShiki(monaco);

// GitHub light (Primer prettylights) 구문 강조
monaco.editor.defineTheme('github-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '1F2328' },
    { token: 'keyword', foreground: 'CF222E' },
    { token: 'storage', foreground: 'CF222E' },
    { token: 'string', foreground: '0A3069' },
    { token: 'string.escape', foreground: '0A3069' },
    { token: 'regexp', foreground: '0A3069' },
    { token: 'comment', foreground: '59636E' },
    { token: 'number', foreground: '0550AE' },
    { token: 'constant', foreground: '0550AE' },
    { token: 'type', foreground: '953800' },
    { token: 'type.identifier', foreground: '953800' },
    { token: 'identifier', foreground: '1F2328' },
    { token: 'variable', foreground: '953800' },
    { token: 'delimiter', foreground: '1F2328' },
    { token: 'tag', foreground: '116329' },
    { token: 'metatag', foreground: '116329' },
    { token: 'attribute.name', foreground: '0550AE' },
    { token: 'attribute.value', foreground: '0A3069' },
    { token: 'key', foreground: '0550AE' },
    { token: 'string.key.json', foreground: '0550AE' },
    { token: 'string.value.json', foreground: '0A3069' },
    { token: 'annotation', foreground: '8250DF' },
    ...shikiThemeRules(),
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#1F2328',
    'editorLineNumber.foreground': '#8C959F',
    'editorLineNumber.activeForeground': '#1F2328',
    'editor.selectionBackground': '#B6E3FF',
    'editor.inactiveSelectionBackground': '#DDF4FF',
    'editor.lineHighlightBackground': '#F6F8FA',
    'editorGutter.background': '#FFFFFF',
    'editorIndentGuide.background1': '#EAEEF2',
    'editorWhitespace.foreground': '#D0D7DE',
    // 줄 배경은 선택 영역 위에 그려지므로 반투명이어야 선택이 보인다.
    // 흰 배경에서 줄은 #DAFBE1, #FFEBE9이 되고, 글자 강조는 줄 배경 위에 겹쳐 #ABF2BC가 된다(GitHub 색)
    'diffEditor.insertedLineBackground': '#6CEF8840',
    'diffEditor.removedLineBackground': '#FFAFA740',
    'diffEditor.insertedTextBackground': '#7CE99780',
    'diffEditor.removedTextBackground': '#FF818266',
    'diffEditorGutter.insertedLineBackground': '#CCFFD8',
    'diffEditorGutter.removedLineBackground': '#FFD7D5',
    'diffEditor.unchangedRegionBackground': '#DDF4FF',
    'diffEditor.unchangedRegionForeground': '#0969DA',
    'diffEditor.diagonalFill': '#EAEEF2',
    'scrollbarSlider.background': '#8C959F33',
    // 스크롤 시 상위 블록 줄을 고정하는 영역(sticky scroll): 본문과 구분되게
    'editorStickyScroll.background': '#F6F8FA',
    'editorStickyScrollGutter.background': '#F6F8FA',
    'editorStickyScroll.border': '#D0D7DE',
    'editorStickyScroll.shadow': '#1F232826',
  },
});
// GitHub dark (Primer prettylights) 구문 강조
monaco.editor.defineTheme('github-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'E6EDF3' },
    { token: 'keyword', foreground: 'FF7B72' },
    { token: 'storage', foreground: 'FF7B72' },
    { token: 'string', foreground: 'A5D6FF' },
    { token: 'string.escape', foreground: 'A5D6FF' },
    { token: 'regexp', foreground: 'A5D6FF' },
    { token: 'comment', foreground: '9198A1' },
    { token: 'number', foreground: '79C0FF' },
    { token: 'constant', foreground: '79C0FF' },
    { token: 'type', foreground: 'FFA657' },
    { token: 'type.identifier', foreground: 'FFA657' },
    { token: 'identifier', foreground: 'E6EDF3' },
    { token: 'variable', foreground: 'FFA657' },
    { token: 'delimiter', foreground: 'E6EDF3' },
    { token: 'tag', foreground: '7EE787' },
    { token: 'metatag', foreground: '7EE787' },
    { token: 'attribute.name', foreground: '79C0FF' },
    { token: 'attribute.value', foreground: 'A5D6FF' },
    { token: 'key', foreground: '79C0FF' },
    { token: 'string.key.json', foreground: '79C0FF' },
    { token: 'string.value.json', foreground: 'A5D6FF' },
    { token: 'annotation', foreground: 'D2A8FF' },
    ...shikiThemeRules(),
  ],
  colors: {
    'editor.background': '#0D1117',
    'editor.foreground': '#E6EDF3',
    'editorLineNumber.foreground': '#6E7681',
    'editorLineNumber.activeForeground': '#E6EDF3',
    'editor.selectionBackground': '#264F78',
    'editor.inactiveSelectionBackground': '#1F6FEB33',
    'editor.lineHighlightBackground': '#161B22',
    'editorGutter.background': '#0D1117',
    'editorIndentGuide.background1': '#21262D',
    'editorWhitespace.foreground': '#30363D',
    'diffEditor.insertedLineBackground': '#2EA04326',
    'diffEditor.removedLineBackground': '#F8514926',
    'diffEditor.insertedTextBackground': '#2EA04333',
    'diffEditor.removedTextBackground': '#F8514933',
    'diffEditorGutter.insertedLineBackground': '#3FB9504D',
    'diffEditorGutter.removedLineBackground': '#F851494D',
    'diffEditor.unchangedRegionBackground': '#172B45',
    'diffEditor.unchangedRegionForeground': '#4493F8',
    'diffEditor.diagonalFill': '#21262D',
    'scrollbarSlider.background': '#8B949E33',
    'editorStickyScroll.background': '#161B22',
    'editorStickyScrollGutter.background': '#161B22',
    'editorStickyScroll.border': '#30363D',
    'editorStickyScroll.shadow': '#01040999',
  },
});
monaco.editor.setTheme('github-light');

// 확장자 → Monaco 언어 id
export function languageOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const byExt = monaco.languages.getLanguages().find((l) => l.extensions?.includes(ext));
  return byExt?.id ?? 'plaintext';
}

// 공통 읽기 전용 옵션(VSCode식 크롬 끄기)
export const READONLY_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  contextmenu: false,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  occurrencesHighlight: 'off',
  links: false,
  hover: { enabled: 'off' },
  glyphMargin: true,
  folding: false,
} satisfies monaco.editor.IEditorOptions;

export { monaco };
