import { Fragment, useEffect, useRef, useState } from 'react';
import { type DiffAttachContext, DiffTab } from './diff/DiffTab.tsx';
import { FileTab } from './diff/FileTab.tsx';
import { BottomPanel } from './layout/BottomPanel.tsx';
import { ChangesAndFiles } from './layout/ChangesAndFiles.tsx';
import { CommitList } from './layout/CommitList.tsx';
import { EditorTabs } from './layout/EditorTabs.tsx';
import { Splitter, usePanelSize } from './layout/Splitter.tsx';
import { TopBar } from './layout/TopBar.tsx';
import { ContextMenu, copyText, type MenuItem, useContextMenu } from './contextMenu.tsx';
import { Tooltip } from './Tooltip.tsx';
import { attachComments, type CommentsHandle } from './feedback/commentZones.ts';
import { CommentDialog, FeedbackPanel } from './feedback/FeedbackPanel.tsx';
import { useFeedback } from './feedback/storage.ts';
import { useSidebarLayout } from './settings/sidebarLayout.ts';
import { FindInFilesPanel, useFindInFilesKey } from './nav/FindInFilesPanel.tsx';
import { FindUsagesPanel } from './nav/FindUsagesPanel.tsx';
import { NavLoadingIndicator } from './nav/NavLoadingIndicator.tsx';
import { UsagesPopup } from './nav/UsagesPopup.tsx';
import { attachNavigation, type NavHandle, useGlobalNavKeys, useWarmOnFocus } from './nav/useNavigation.ts';
import { monaco } from './monaco/setup.ts';
import { getPref, setPref } from './prefs.ts';
import type { Source } from '../../server/shared/types.ts';
import { type Tab, useStore } from './store.ts';

interface EditorMenuOptions {
  path: string;
  nav?: NavHandle;
  comments?: { handle: CommentsHandle; side: 'old' | 'new' };
  onFileComment?: () => void;
}

// 에디터 우클릭: Monaco 기본 메뉴 대신 앱 메뉴(탐색·코멘트·복사)
// 선택 영역을 클립보드로(읽기 전용 에디터에서도 확실히 복사되도록 직접 쓴다)
function copySelection(editor: monaco.editor.ICodeEditor) {
  const sel = editor.getSelection();
  const text = sel && !sel.isEmpty() ? editor.getModel()?.getValueInRange(sel) : '';
  if (text) copyText(text, '선택한 텍스트');
}

function attachEditorMenu(editor: monaco.editor.ICodeEditor, opts: EditorMenuOptions): monaco.IDisposable {
  const copyKey = editor.onKeyDown((e) => {
    // Cmd+C는 Orca 단축키와 겹쳐 함께 실행되므로 Ctrl+C로 복사한다
    if (e.ctrlKey && !e.metaKey && e.keyCode === monaco.KeyCode.KeyC && !editor.getSelection()?.isEmpty()) {
      e.preventDefault();
      e.stopPropagation();
      copySelection(editor);
    }
  });
  // Orca가 Cmd+F를 가져가므로 Ctrl+F로 찾기를 연다. Mac 기본값(커서 오른쪽)을 덮으려고 키바인딩으로 등록한다
  // diff 에디터 안쪽 에디터도 런타임에는 StandaloneCodeEditor라 addAction이 있다
  const findKey = (editor as monaco.editor.IStandaloneCodeEditor).addAction({
    id: 'orca-diff.find',
    label: '찾기',
    keybindings: [monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyF],
    run: (ed: monaco.editor.ICodeEditor) => ed.getAction('actions.find')?.run(),
  });
  const menu = editor.onContextMenu((e) => {
    e.event.preventDefault();
    e.event.stopPropagation();
    const pos = e.target.position ?? editor.getPosition();
    if (!pos) return;
    const sel = editor.getSelection();
    const inSelection = !!sel && !sel.isEmpty() && sel.containsPosition(pos);
    if (!inSelection) editor.setPosition(pos);
    const start = inSelection ? sel.startLineNumber : pos.lineNumber;
    const end = inSelection && sel.endColumn === 1 && sel.endLineNumber > start ? sel.endLineNumber - 1 : inSelection ? sel.endLineNumber : pos.lineNumber;
    const range = start === end ? `${start}` : `${start}-${end}`;

    const items: MenuItem[] = [];
    if (inSelection) {
      items.push({ label: '선택한 텍스트 복사', shortcut: '⌃C', onSelect: () => copySelection(editor) }, 'separator');
    }
    if (opts.nav?.enabled) {
      items.push(
        { label: '선언으로 이동', shortcut: '⌘B', onSelect: () => opts.nav!.goToDeclaration(pos) },
        { label: '사용처 찾기', shortcut: 'fn⌥F7', onSelect: () => opts.nav!.findUsages(pos) },
        'separator',
      );
    }
    if (opts.comments) {
      const { handle, side } = opts.comments;
      items.push({ label: start === end ? `${start}행에 코멘트` : `선택한 ${start}-${end}행에 코멘트`, onSelect: () => handle.openComposer(side, start, end) });
    }
    if (opts.onFileComment) items.push({ label: '파일 전체에 코멘트', onSelect: opts.onFileComment });
    if (opts.comments || opts.onFileComment) items.push('separator');
    items.push(
      { label: '경로:줄 복사', onSelect: () => copyText(`${opts.path}:${range}`, '경로') },
      { label: '경로 복사', onSelect: () => copyText(opts.path, '경로') },
    );
    useContextMenu.getState().open(e.event.posx, e.event.posy, items);
  });
  return {
    dispose() {
      copyKey.dispose();
      findKey.dispose();
      menu.dispose();
    },
  };
}

const sourceLabel = (s: Source) =>
  s.kind === 'commits' ? (s.from === s.to ? `커밋 ${s.to.slice(0, 7)}` : `커밋 ${s.from.slice(0, 7)}..${s.to.slice(0, 7)}`) : s.kind;

// diff에서는 수정본(오른쪽)에서만 탐색한다. 워킹트리 unstaged가 아니면 diff에 보이는 내용 기준으로 질의한다.
function attachDiff(ctx: DiffAttachContext): monaco.IDisposable {
  const comments = attachComments({
    source: ctx.source,
    change: ctx.change,
    editors: { old: ctx.editors.original, new: ctx.editors.modified },
    contents: { old: ctx.pair.original, new: ctx.pair.modified },
    sides: ctx.single ? [ctx.single] : undefined,
  });
  const override = ctx.source.kind === 'unstaged' ? undefined : ctx.pair.modified;
  const nav = ctx.change.status === 'D'
    ? undefined
    : attachNavigation(ctx.editors.modified, {
        path: ctx.change.path,
        contentOverride: () => override,
        origin: { source: ctx.source, change: ctx.change, label: sourceLabel(ctx.source) },
      });
  const onFileComment = () => useFeedback.getState().openDialog({ kind: 'file', source: ctx.source, path: ctx.change.path });
  const sides = ctx.single ? [ctx.single] : (['old', 'new'] as const);
  const menus = sides.map((side) =>
    attachEditorMenu(side === 'new' ? ctx.editors.modified : ctx.editors.original, {
      path: side === 'old' ? (ctx.change.oldPath ?? ctx.change.path) : ctx.change.path,
      nav: side === 'new' ? nav : undefined,
      comments: { handle: comments, side },
      onFileComment,
    }),
  );
  return {
    dispose() {
      comments.dispose();
      nav?.dispose();
      menus.forEach((m) => m.dispose());
    },
  };
}

function fileCommentButton(tab: Tab) {
  if (tab.kind !== 'diff') return null;
  return (
    <button
      className="close"
      title="파일 전체에 코멘트"
      onClick={(e) => {
        e.stopPropagation();
        useFeedback.getState().openDialog({ kind: 'file', source: tab.source, path: tab.change.path });
      }}
    >
      💬
    </button>
  );
}

function attachFile(editor: monaco.editor.ICodeEditor, path: string): monaco.IDisposable {
  const nav = attachNavigation(editor, { path, contentOverride: () => undefined });
  const menu = attachEditorMenu(editor, { path, nav });
  return {
    dispose() {
      nav.dispose();
      menu.dispose();
    },
  };
}

function renderTab(tab: Tab) {
  return tab.kind === 'diff' ? (
    <DiffTab source={tab.source} change={tab.change} reveal={tab.reveal} attach={attachDiff} />
  ) : (
    <FileTab path={tab.path} reveal={tab.reveal} attach={attachFile} />
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>{t.message}</div>
      ))}
    </div>
  );
}

// 자동 모드에서 이 너비보다 좁으면 사이드바를 하단으로 내린다
const NARROW_QUERY = '(max-width: 899px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function App() {
  const [leftPaneVisible, setLeftPaneVisible] = useState(() => getPref('leftPaneVisible', true));
  const { position: sidebarPosition, belowTools: sidebarBelowTools } = useSidebarLayout();
  const narrow = useNarrow();
  const atBottom = sidebarPosition === 'bottom' || (sidebarPosition === 'auto' && narrow);
  const showBottomSidebar = atBottom && leftPaneVisible;
  const emptyViewerMessage = leftPaneVisible
    ? `${atBottom ? '아래' : '왼쪽'}에서 커밋과 파일을 선택하세요`
    : '상단에서 사이드바를 열거나 Shift를 두 번 눌러 파일을 검색하세요';
  const [sidebarHeight, setSidebarHeight] = usePanelSize('sidebarBottom', 240);
  // 하단 배치의 Commits 너비는 비율로 저장해 창 너비가 바뀌어도 Changes와 같은 비율을 유지한다
  const [commitsRatio, setCommitsRatio] = usePanelSize('commitsRatio', 0.4);
  const sidebarRow = useRef<HTMLDivElement>(null);
  const rowWidth = () => sidebarRow.current?.clientWidth || 1;
  const [leftWidth, setLeftWidth] = usePanelSize('left', 360);
  const [commitsHeight, setCommitsHeight] = usePanelSize('commits', 320);
  const [bottomHeight, setBottomHeight] = usePanelSize('bottom', 220);
  const bottomOpen = useStore((s) => s.bottomPanel !== null);
  useGlobalNavKeys();
  useWarmOnFocus();
  useFindInFilesKey();
  const unsentCount = useFeedback((s) => s.comments.filter((c) => !c.sentAt).length);

  const toggleLeftPane = () => {
    const visible = !leftPaneVisible;
    setLeftPaneVisible(visible);
    setPref('leftPaneVisible', visible, { immediate: true });
  };

  const sidebar = showBottomSidebar && (
    <Fragment key="sidebar">
      <div className="sidebar-bottom-commits" style={{ height: sidebarHeight }}>
        <CommitList />
      </div>
      <Splitter
        direction="vertical"
        size={commitsRatio * rowWidth()}
        // Changes에도 최소 200px은 남긴다
        onResize={(px) => setCommitsRatio(Math.min(px, rowWidth() - 200) / rowWidth())}
        min={200}
      />
      <ChangesAndFiles />
    </Fragment>
  );
  const tools = (
    <div key="tools" className="tools-pane">
      {bottomOpen && <Splitter direction="horizontal" size={bottomHeight} onResize={setBottomHeight} invert />}
      <div style={{ height: bottomOpen ? bottomHeight : 'auto', display: 'flex' }}>
        <BottomPanel usages={<FindUsagesPanel />} search={<FindInFilesPanel />} feedback={<FeedbackPanel />} feedbackCount={unsentCount} />
      </div>
    </div>
  );

  return (
    <div className="app">
      <TopBar leftPaneVisible={leftPaneVisible} onToggleLeftPane={toggleLeftPane} atBottom={atBottom} />
      <div className={leftPaneVisible ? 'main' : 'main left-pane-hidden'}>
        {!atBottom && (
          <>
            <div id="left-pane" className="left-pane" style={{ width: leftWidth }}>
              <div style={{ height: commitsHeight, display: 'flex' }}>
                <CommitList />
              </div>
              <Splitter direction="horizontal" size={commitsHeight} onResize={setCommitsHeight} />
              <ChangesAndFiles />
            </div>
            <Splitter direction="vertical" size={leftWidth} onResize={setLeftWidth} min={200} />
          </>
        )}
        <div className="center-pane">
          <EditorTabs renderTab={renderTab} tabActions={fileCommentButton} emptyMessage={emptyViewerMessage} />
          {showBottomSidebar && <Splitter direction="horizontal" size={sidebarHeight} onResize={setSidebarHeight} invert />}
          <div
            id={showBottomSidebar ? 'left-pane' : undefined}
            className={showBottomSidebar ? `sidebar-bottom${sidebarBelowTools ? ' tools-first' : ''}` : undefined}
            ref={sidebarRow}
            style={showBottomSidebar ? { gridTemplateColumns: `${commitsRatio * 100}% auto minmax(0, 1fr)` } : undefined}
          >
            {sidebarBelowTools ? [tools, sidebar] : [sidebar, tools]}
          </div>
        </div>
      </div>
      <UsagesPopup />
      <NavLoadingIndicator />
      <CommentDialog />
      <ContextMenu />
      <Tooltip />
      <Toasts />
    </div>
  );
}
