import { useEffect } from 'react';
import { create } from 'zustand';
import type { Change, Location, Source } from '../../../server/shared/types.ts';
import { getDefinition, getReferences, type NavQuery } from '../api.ts';
import { monaco } from '../monaco/setup.ts';
import { getPref, setPref } from '../prefs.ts';
import { withLoading } from './loading.ts';
import { navKeyAction } from './navKeys.ts';
import { diffTabId, type NavEntry, useStore } from '../store.ts';

export const TS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

export interface UsagesPopupState {
  references?: boolean;
  x: number;
  y: number;
  title: string;
  locations: Location[];
  // diff에 보이는 내용으로 질의했으면 그 파일의 미리보기도 같은 내용으로 그린다(워킹트리와 줄이 다를 수 있음)
  override?: { path: string; content: string };
  origin?: NavOrigin;
  word: string; // 목록과 미리보기에서 강조할 심볼 이름
}

// diff 내용(커밋·staged)으로 질의한 결과의 기준. 그 파일 안의 결과는 이 diff 탭 기준 줄 번호다.
// 함수 대신 데이터로 두어 새로 고침 뒤 복원해도 같은 곳으로 이동한다(탭이 닫혔으면 다시 연다).
export interface NavOrigin { source: Source; change: Change; label: string }

// 예전 저장본에는 word·origin·basis가 없을 수 있다. basis는 제목에 붙는 기준(예: 커밋 abc1234, 워킹트리)
export interface UsagesResult { title: string; word?: string; locations: Location[]; origin?: NavOrigin; basis?: string }

export const useNavUi = create<{
  hideImports: boolean;
  toggleImports(): void;
  popup: UsagesPopupState | null;
  usages: UsagesResult | null;
  setPopup(p: UsagesPopupState | null): void;
  setUsages(u: UsagesResult | null): void;
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
  // contentOverride가 있을 때 결과의 기준이 되는 diff
  origin?: NavOrigin;
}

// 결과 파일의 기준. tsserver는 질의한 파일만 diff 내용으로 보고 나머지는 워킹트리에서 읽으므로,
// diff에서 찾은 결과는 그 파일만 diff 기준이고 다른 파일은 워킹트리 기준이다. diff에서 찾은 게 아니면 null.
export function basisOf(path: string, origin?: NavOrigin): string | null {
  if (!origin?.source) return null;
  return path === origin.change.path ? origin.label : '워킹트리';
}

// 결과 위치로 이동한다. 기준 diff와 같은 파일이면 그 diff 탭에서(닫혔으면 다시 열어), 아니면 워킹트리 파일로 연다.
export function jumpToResult(loc: Location, origin?: NavOrigin) {
  // 예전 형식으로 저장된 결과에는 source가 없다
  if (!origin?.source || loc.path !== origin.change.path) return jumpTo(loc);
  const { pushNav, openDiff, revealDiff } = useStore.getState();
  if (currentLocation) pushNav(currentLocation);
  openDiff(origin.source, origin.change);
  revealDiff(diffTabId(origin.source, origin.change), { line: loc.line, column: loc.column });
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
    const content = ctx.contentOverride();
    return {
      x: (rect?.left ?? 0) + (visible?.left ?? 0),
      y: (rect?.top ?? 0) + (visible?.top ?? 0) + (visible?.height ?? 18),
      override: content === undefined ? undefined : { path: ctx.path, content },
      origin: originOf(),
      word: wordLabel(pos),
    };
  };

  const originOf = (): NavOrigin | undefined => (ctx.contentOverride() !== undefined ? ctx.origin : undefined);
  const jump = (loc: Location) => jumpToResult(loc, originOf());

  const wordLabel = (pos: monaco.IPosition) => editor.getModel()?.getWordAtPosition(pos)?.word ?? '';

  const findUsages = async (pos: monaco.IPosition) => {
    try {
      const locations = await withLoading('사용처 찾는 중', () => getReferences(query(pos)));
      setUsages({ title: wordLabel(pos), word: wordLabel(pos), locations, origin: originOf(), basis: originOf()?.label ?? '워킹트리' });
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
        else if (refs.length === 1 && !(useNavUi.getState().hideImports && refs[0].isImport)) jump(refs[0]);
        else setPopup({ ...popupAt(pos), references: true, title: wordLabel(pos), locations: refs });
        return;
      }
      if (locations.length === 1) jump(locations[0]);
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
