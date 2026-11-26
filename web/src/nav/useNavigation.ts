import { useEffect } from 'react';
import { create } from 'zustand';
import type { Location } from '../../../server/shared/types.ts';
import { getDefinition, getReferences, type NavQuery } from '../api.ts';
import { monaco } from '../monaco/setup.ts';
import { getPref, setPref } from '../prefs.ts';
import { withLoading } from './loading.ts';
import { navKeyAction } from './navKeys.ts';
import { type NavEntry, useStore } from '../store.ts';

export const TS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

export interface UsagesPopupState { references?: boolean; x: number; y: number; title: string; locations: Location[] }

export const useNavUi = create<{
  hideImports: boolean;
  toggleImports(): void;
  popup: UsagesPopupState | null;
  usages: { title: string; locations: Location[] } | null;
  setPopup(p: UsagesPopupState | null): void;
  setUsages(u: { title: string; locations: Location[] } | null): void;
}>((set) => ({
  hideImports: getPref('hideImports', true),
  toggleImports: () => set(s => {
    const hideImports = !s.hideImports;
    setPref('hideImports', hideImports);
    return { hideImports };
  }),
  popup: null,
  usages: null,
  setPopup: (popup) => set({ popup }),
  setUsages: (usages) => set({ usages }),
}));

// 마지막으로 커서가 있던 위치(뒤로 가기 기록용)
let currentLocation: NavEntry | null = null;

export function jumpTo(loc: Location) {
  const { pushNav, openFile } = useStore.getState();
  if (currentLocation) pushNav(currentLocation);
  openFile(loc.path, { line: loc.line, column: loc.column });
}

interface NavContext {
  path: string;
  // diff의 수정본이 디스크와 다를 때만 그 내용을 돌려준다
  contentOverride: () => string | undefined;
}

export interface NavHandle extends monaco.IDisposable {
  enabled: boolean; // TS/JS 파일일 때만
  goToDeclaration(pos: monaco.IPosition): void;
  findUsages(pos: monaco.IPosition): void;
}

export function attachNavigation(editor: monaco.editor.ICodeEditor, ctx: NavContext): NavHandle {
  if (!TS_EXT.test(ctx.path)) return { enabled: false, dispose() {}, goToDeclaration() {}, findUsages() {} };
  const { toast, setBottomPanel } = useStore.getState();
  const { setPopup, setUsages } = useNavUi.getState();
  const linkDeco = editor.createDecorationsCollection();

  const query = (pos: monaco.IPosition): NavQuery => ({
    path: ctx.path,
    line: pos.lineNumber,
    column: pos.column,
    content: ctx.contentOverride(),
  });

  const popupAt = (pos: monaco.IPosition) => {
    const visible = editor.getScrolledVisiblePosition(pos);
    const rect = editor.getDomNode()?.getBoundingClientRect();
    return { x: (rect?.left ?? 0) + (visible?.left ?? 0), y: (rect?.top ?? 0) + (visible?.top ?? 0) + (visible?.height ?? 18) };
  };

  const wordLabel = (pos: monaco.IPosition) => editor.getModel()?.getWordAtPosition(pos)?.word ?? '';

  const findUsages = async (pos: monaco.IPosition) => {
    try {
      const locations = await withLoading('사용처 찾는 중', () => getReferences(query(pos)));
      setUsages({ title: wordLabel(pos), locations });
      setBottomPanel('usages');
    } catch (e) {
      toast(`사용처 찾기 실패: ${(e as Error).message}`, 'error');
    }
  };

  // WebStorm: 선언으로 이동, 이미 선언 위면 사용처 팝업
  const goToDeclaration = async (pos: monaco.IPosition) => {
    try {
      const word = editor.getModel()?.getWordAtPosition(pos);
      const locations = await withLoading('선언 찾는 중', () => getDefinition(query(pos)));
      if (locations.length === 0) {
        toast('선언을 찾을 수 없습니다');
        return;
      }
      const onDeclaration = locations.some(
        (l) => l.path === ctx.path && l.line === pos.lineNumber && word && l.column >= word.startColumn && l.column <= word.endColumn,
      );
      if (onDeclaration) {
        const refs = await withLoading('사용처 찾는 중', () => getReferences(query(pos)));
        if (refs.length === 0) toast('사용처가 없습니다');
        else if (refs.length === 1 && !(useNavUi.getState().hideImports && refs[0].isImport)) jumpTo(refs[0]);
        else setPopup({ ...popupAt(pos), references: true, title: wordLabel(pos), locations: refs });
        return;
      }
      if (locations.length === 1) jumpTo(locations[0]);
      else setPopup({ ...popupAt(pos), title: `${wordLabel(pos)} 선언 ${locations.length}건`, locations });
    } catch (e) {
      toast(`선언 찾기 실패: ${(e as Error).message}`, 'error');
    }
  };

  const disposables = [
    editor.onDidChangeCursorPosition((e) => {
      if (editor.hasTextFocus()) currentLocation = { path: ctx.path, line: e.position.lineNumber, column: e.position.column, tabId: useStore.getState().activeTabId };
    }),
    editor.onMouseDown((e) => {
      if (e.event.metaKey && e.target.position && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT) {
        e.event.preventDefault();
        currentLocation = { path: ctx.path, line: e.target.position.lineNumber, column: e.target.position.column, tabId: useStore.getState().activeTabId };
        goToDeclaration(e.target.position);
      }
    }),
    // Cmd를 누른 채 호버하면 링크처럼 밑줄
    editor.onMouseMove((e) => {
      const pos = e.target.position;
      const word = pos && e.event.metaKey ? editor.getModel()?.getWordAtPosition(pos) : null;
      linkDeco.set(
        word && pos
          ? [{ range: new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn), options: { inlineClassName: 'nav-link' } }]
          : [],
      );
    }),
    editor.onMouseLeave(() => linkDeco.clear()),
    editor.onKeyUp((e) => {
      if (e.keyCode === monaco.KeyCode.Meta) linkDeco.clear();
    }),
    // Ctrl+B: Orca가 Cmd+B를 사이드바 토글로 쓰므로 대체 키. Mac 기본값(커서 왼쪽)을 덮으려고 키바인딩으로 등록한다
    (editor as monaco.editor.IStandaloneCodeEditor).addAction({
      id: 'orca-diff.goToDeclaration',
      label: '선언으로 이동',
      keybindings: [monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyB],
      run: (ed: monaco.editor.ICodeEditor) => {
        const pos = ed.getPosition();
        if (pos) goToDeclaration(pos);
      },
    }),
    editor.onKeyDown((e) => {
      const pos = editor.getPosition();
      if (!pos) return;
      if (e.metaKey && e.keyCode === monaco.KeyCode.KeyB) {
        e.preventDefault();
        e.stopPropagation();
        goToDeclaration(pos);
      } else if (e.altKey && (e.keyCode === monaco.KeyCode.F7 || e.code === 'F7')) {
        e.preventDefault();
        e.stopPropagation();
        findUsages(pos);
      }
    }),
  ];
  return {
    enabled: true,
    goToDeclaration,
    findUsages,
    dispose() {
      linkDeco.clear();
      disposables.forEach((d) => d.dispose());
    },
  };
}

// 뒤로/앞으로: Cmd+[ / Cmd+], 대체 키 Alt+←/→, 마우스 뒤로/앞으로 버튼
export function useGlobalNavKeys() {
  useEffect(() => {
    const back = () => useStore.getState().goBack(currentLocation);
    const forward = () => useStore.getState().goForward(currentLocation);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      // 읽기 전용 Monaco 뷰어는 키 입력을 받기 위해 내부 textarea에 포커스를 둔다.
      const inTextInput = target instanceof HTMLElement
        && (target.isContentEditable || target.matches('input, textarea, select'))
        && !target.matches('.monaco-editor textarea.inputarea[readonly]');
      const action = navKeyAction({ key: e.key, metaKey: e.metaKey, altKey: e.altKey, inTextInput });
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'back') back();
      else forward();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) back();
      else if (e.button === 4) forward();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);
}
