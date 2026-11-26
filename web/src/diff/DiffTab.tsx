import { markdownChanges } from './markdownChanges.ts';
import { MarkdownPage } from './MarkdownPage.tsx';
import { rememberView } from './rememberView.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Change, FilePair, Source } from '../../../server/shared/types.ts';
import { getFilePair } from '../api.ts';
import { formatJson } from './formatJson.ts';
import { PatchView } from './PatchView.tsx';
import { getPref, setPref } from '../prefs.ts';
import { languageOf, monaco, READONLY_OPTIONS } from '../monaco/setup.ts';
import { editorFontOptions, useFontSettings } from '../settings/fontSettings.ts';
import { useStore } from '../store.ts';

const POLL_MS = 3000;
const PREFS_KEY = 'orca-review:diff-prefs';

interface DiffPrefs { sideBySide: boolean; hunksOnly: boolean; formatJson: boolean }

function loadPrefs(): DiffPrefs {
  let legacy: Partial<DiffPrefs> = {};
  try {
    legacy = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    // 예전 값이 없거나 깨졌으면 무시
  }
  return { sideBySide: true, hunksOnly: true, formatJson: false, ...getPref<Partial<DiffPrefs>>('diff', legacy) };
}

// Split/Unified, Hunks/전체 토글은 모든 diff 탭이 공유하고 마지막 선택을 기억한다
const usePrefs = create<DiffPrefs & { set(p: Partial<DiffPrefs>): void }>((set, get) => ({
  ...loadPrefs(),
  set: (p) => {
    set(p);
    const { sideBySide, hunksOnly, formatJson } = get();
    setPref('diff', { sideBySide, hunksOnly, formatJson });
  },
}));

export interface DiffEditors {
  original: monaco.editor.ICodeEditor;
  modified: monaco.editor.ICodeEditor;
}

export interface DiffAttachContext {
  editors: DiffEditors;
  // 새 파일('new')/삭제 파일('old')은 한쪽만 보여주며 editors의 두 값이 같은 에디터다
  single?: 'old' | 'new';
  pair: FilePair;
  source: Source;
  change: Change;
}

interface Props {
  source: Source;
  change: Change;
  reveal?: { line: number; column: number }; // 수정본에서 이 줄로 이동
  // 에디터가 준비되거나 내용이 바뀔 때마다 호출된다. 반환한 disposable은 다음 호출 전에 정리된다.
  attach?: (ctx: DiffAttachContext) => monaco.IDisposable | void;
}

export function DiffTab({ source, change, reveal, attach }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const singleRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // 새 파일/삭제 파일은 한쪽이 비어 있어 diff로 그리면 '빈 줄 1개 → 전체' 변경으로 보인다. 한쪽만 그린다.
  const single = change.status === 'A' ? 'new' : change.status === 'D' ? 'old' : undefined;
  const [pair, setPair] = useState<FilePair | null>(null);
  const { sideBySide, hunksOnly, formatJson: formatJsonOn, set } = usePrefs();
  const isJson = /\.json$/i.test(change.path);
  const refreshTick = useStore((s) => s.refreshTick);
  const toast = useStore((s) => s.toast);
  const font = useFontSettings();

  // 내용 로드(워킹트리 기준이면 주기적으로 다시 읽는다)
  useEffect(() => {
    let cancelled = false;
    let last = '';
    const load = async () => {
      try {
        const next = await getFilePair(source, change);
        const json = JSON.stringify(next);
        if (!cancelled && json !== last) {
          last = json;
          setPair(next);
        }
      } catch (e) {
        if (!cancelled) toast(`diff 로드 실패: ${(e as Error).message}`, 'error');
      }
    };
    load();
    const timer = source.kind !== 'commits' ? setInterval(load, POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [source, change, refreshTick, toast]);

  // JSON 포맷 보기: 양쪽을 정리해서 비교한다(줄 번호가 실제 파일과 달라지므로 코멘트·메뉴는 붙이지 않는다)
  const view = useMemo(() => {
    if (!pair || !isJson || !formatJsonOn || pair.tooLarge || pair.binary) return { shown: pair, formatted: false, failed: false };
    const original = formatJson(pair.original);
    const modified = formatJson(pair.modified);
    if (original === null || modified === null) return { shown: pair, formatted: false, failed: true };
    return { shown: { ...pair, original, modified }, formatted: true, failed: false };
  }, [pair, isJson, formatJsonOn]);
  const shown = view.shown;
  const canAttach = !view.formatted;

  // 에디터 생성
  const isSvg = /\.svg$/i.test(change.path);
  const [svgSource, setSvgSource] = useState(false);
  const preview = pair && !pair.tooLarge && (pair.image || (isSvg && !pair.binary && !svgSource));
  const [renderMarkdown, setRenderMarkdown] = useState(false);
  const isMarkdown = /\.(md|markdown)$/i.test(change.path) && pair && !pair.tooLarge && !pair.binary;
  const markdownPreview = isMarkdown && renderMarkdown;
  const mdChanges = useMemo(() => markdownPreview && !single ? markdownChanges(pair.original, pair.modified) : undefined, [markdownPreview, single, pair]);
  const showEditor = !markdownPreview && !preview && pair !== null && !pair.binary && !pair.tooLarge;
  useEffect(() => {
    if (!showEditor || !host.current || !single) return;
    const editor = monaco.editor.create(host.current, {
      ...READONLY_OPTIONS,
      ...editorFontOptions(useFontSettings.getState()),
      model: monaco.editor.createModel('', languageOf(change.path)),
    });
    singleRef.current = editor;
    return () => {
      const model = editor.getModel();
      editor.dispose();
      model?.dispose();
      singleRef.current = null;
    };
  }, [showEditor, single, change.path]);

  useEffect(() => {
    if (!showEditor || !host.current || single) return;
    const editor = monaco.editor.createDiffEditor(host.current, {
      ...READONLY_OPTIONS,
      ...editorFontOptions(useFontSettings.getState()),
      originalEditable: false,
      renderSideBySide: usePrefs.getState().sideBySide,
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: true,
      hideUnchangedRegions: { enabled: usePrefs.getState().hunksOnly, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
    });
    const lang = languageOf(change.path);
    editor.setModel({
      original: monaco.editor.createModel('', lang),
      modified: monaco.editor.createModel('', lang),
    });
    editorRef.current = editor;
    return () => {
      const model = editor.getModel();
      editor.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      editorRef.current = null;
    };
  }, [showEditor, single, change.path]);

  // 내용 반영 + 부착(탐색·코멘트)
  useEffect(() => {
    const ed = singleRef.current;
    if (!single || !ed || !shown) return;
    const content = single === 'new' ? shown.modified : shown.original;
    if (ed.getModel()?.getValue() !== content) ed.getModel()?.setValue(content);
    const lineCount = ed.getModel()?.getLineCount() ?? 1;
    const deco = ed.createDecorationsCollection([
      {
        range: new monaco.Range(1, 1, lineCount, 1),
        options: {
          isWholeLine: true,
          className: single === 'new' ? 'full-insert-line' : 'full-delete-line',
          marginClassName: single === 'new' ? 'full-insert-margin' : 'full-delete-margin',
        },
      },
    ]);
    const disposable = canAttach ? attach?.({ editors: { original: ed, modified: ed }, single, pair: shown, source, change }) : undefined;
    return () => {
      deco.clear();
      disposable?.dispose();
    };
  }, [shown, canAttach, attach, source, change, showEditor, single]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !shown) return;
    if (model.original.getValue() !== shown.original) model.original.setValue(shown.original);
    if (model.modified.getValue() !== shown.modified) model.modified.setValue(shown.modified);
    const disposable = canAttach
      ? attach?.({
          editors: { original: editor.getOriginalEditor(), modified: editor.getModifiedEditor() },
          pair: shown,
          source,
          change,
        })
      : undefined;
    return () => disposable?.dispose();
  }, [shown, canAttach, attach, source, change, showEditor]);

  // 탐색 결과·뒤로 가기로 이 diff의 특정 줄에 올 때(파일 탭의 reveal과 같은 동작)
  useEffect(() => {
    const editor = single === 'new' ? singleRef.current : editorRef.current?.getModifiedEditor();
    if (!editor || !reveal || !shown) return;
    const { line, column } = reveal;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column });
    editor.focus();
    const deco = editor.createDecorationsCollection([
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'reveal-line' } },
    ]);
    const timer = setTimeout(() => deco.clear(), 1500);
    return () => {
      clearTimeout(timer);
      deco.clear();
    };
  }, [reveal, shown, single, showEditor]);

  useEffect(() => {
    editorRef.current?.updateOptions(editorFontOptions(font));
    singleRef.current?.updateOptions(editorFontOptions(font));
    monaco.editor.remeasureFonts();
  }, [font.family, font.size, showEditor, single]);

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide, hideUnchangedRegions: { enabled: hunksOnly } });
  }, [sideBySide, hunksOnly, showEditor]);

  useEffect(() => {
    const id = JSON.stringify([source, change.path, single]);
    if (singleRef.current) return rememberView(id, singleRef.current);
    if (editorRef.current) return rememberView(id, editorRef.current);
  }, [showEditor, source, change.path, single]);

  return (
    <div className="diff-tab">
      <div className="diff-toolbar">
        <span className="path">
          {change.oldPath ? `${change.oldPath} → ` : ''}
          {change.path}
        </span>
        {isMarkdown && <button onClick={() => setRenderMarkdown(!renderMarkdown)}>{renderMarkdown ? '원문 보기' : '렌더 보기'}</button>}
        {isSvg && pair && !pair.tooLarge && !pair.binary && <button onClick={() => setSvgSource(!svgSource)}>{svgSource ? '렌더 결과 보기' : 'SVG 코드 보기'}</button>}
        {isJson && !pair?.tooLarge && !pair?.binary && (
          <button className={`toggle-single ${formatJsonOn ? 'active' : ''}`} title="JSON을 들여쓰기로 정리해서 비교" onClick={() => set({ formatJson: !formatJsonOn })}>
            JSON 포맷
          </button>
        )}
        {single && <span className={`file-badge ${single}`}>{single === 'new' ? '새 파일' : '삭제된 파일'}</span>}
        {!markdownPreview && !preview && !single && !pair?.tooLarge && (
        <>
        <div className="toggle">
          <button className={sideBySide ? 'active' : ''} onClick={() => set({ sideBySide: true })}>Split</button>
          <button className={!sideBySide ? 'active' : ''} onClick={() => set({ sideBySide: false })}>Unified</button>
        </div>
        <div className="toggle">
          <button className={hunksOnly ? 'active' : ''} onClick={() => set({ hunksOnly: true })}>변경 뭉치</button>
          <button className={!hunksOnly ? 'active' : ''} onClick={() => set({ hunksOnly: false })}>전체</button>
        </div>
        </>
        )}
      </div>
      {view.formatted && <div className="patch-notice">JSON 포맷 보기입니다. 줄 번호가 실제 파일과 달라서 라인 코멘트와 우클릭 메뉴를 쓸 수 없습니다(파일 전체 코멘트는 탭의 💬).</div>}
      {view.failed && <div className="patch-notice">JSON 형식이 아니어서 원문 그대로 보여줍니다.</div>}
      {markdownPreview && <div className="markdown-pages">
        {single !== 'new' && <MarkdownPage label="변경 전" changes={mdChanges?.original} text={pair.original} />}
        {single !== 'old' && <MarkdownPage label="변경 후" changes={mdChanges?.modified} text={pair.modified} />}
      </div>}
      {preview && <div className="image-diff">
        {(['original', 'modified'] as const).map(side => {
          if ((side === 'original' && single === 'new') || (side === 'modified' && single === 'old')) return null;
          const label = side === 'original' ? '변경 전' : '변경 후';
          const src = pair.image ? pair[side] : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pair[side]);
          return <figure key={side}><figcaption>{label}</figcaption><img src={src} alt={label + ' ' + change.path} /></figure>;
        })}
      </div>}
      {pair?.image && pair.tooLarge && <div className="editor-empty">12 MiB를 넘는 이미지는 미리볼 수 없습니다.</div>}
      {pair?.binary && !pair.image && <div className="editor-empty">바이너리 파일은 diff를 표시하지 않습니다</div>}
      {pair?.tooLarge && !pair.image && <PatchView source={source} change={change} />}
      {!pair && <div className="editor-empty">불러오는 중…</div>}
      <div ref={host} className="monaco-host" style={{ display: showEditor ? 'block' : 'none' }} />
    </div>
  );
}
