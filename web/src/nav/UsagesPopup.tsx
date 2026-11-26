import { useEffect, useMemo, useRef, useState } from 'react';
import { getFile } from '../api.ts';
import { languageOf, monaco } from '../monaco/setup.ts';
import { getPref, setPref } from '../prefs.ts';
import { useStore } from '../store.ts';
import { parseColorized, type Token } from './colorizedLines.ts';
import { highlight, matchPattern } from './FindInFilesPanel.tsx';
import { useSourceDescription } from '../layout/EditorTabs.tsx';
import { basisTitle } from './FindUsagesPanel.tsx';
import { basisOf, jumpToResult, useNavUi } from './useNavigation.ts';

// 커서 근처에 뜨는 선언/사용처 목록(WebStorm 팝업)
export function UsagesPopup() {
  const { popup, setPopup, setUsages, hideImports, toggleImports } = useNavUi();
  const setBottomPanel = useStore((s) => s.setBottomPanel);
  const [index, setIndex] = useState(0);

  const box = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const locations = (popup?.locations ?? []).filter(l => !(popup?.references && hideImports && l.isImport));
  const selectedIndex = Math.min(index, locations.length - 1);
  const selection = locations[selectedIndex];
  const path = selection?.path;
  const [file, setFile] = useState<{ path: string; lines: string[] | null }>();
  const [size, setSize] = useState(() => getPref('size.usagesPopup', { width: 760, height: 440 }));

  const override = popup?.override;
  const originDesc = useSourceDescription(popup?.origin?.source ?? null);
  const word = popup?.word;
  const pattern = useMemo(() => (word ? matchPattern(word, { caseSensitive: true, wholeWord: true, regex: false }) : null), [word]);
  useEffect(() => {
    if (!path) return;
    if (override?.path === path) {
      setFile({ path, lines: override.content.split(/\r?\n/) });
      return;
    }
    let active = true;
    getFile(path).then(({ content }) => {
      if (active) setFile({ path, lines: content.split(/\r?\n/) });
    }).catch(() => { if (active) setFile({ path, lines: null }); });
    return () => { active = false; };
  }, [path, override]);

  // 미리보기 줄만 칠하면 문자열·주석 중간부터 시작할 때 색이 깨지므로 파일 처음부터 칠한다.
  // 다만 미리보기 마지막 줄까지만 칠하고(여유 200줄), 같은 파일에서 더 아래로 옮길 때만 다시 칠한다.
  const [colored, setColored] = useState<{ file: typeof file; lines: Token[][] }>();
  const needed = selection ? selection.line + 5 : 0;
  useEffect(() => {
    // shortcut: 아주 아래쪽 줄은 칠하는 데 오래 걸리므로 색 없이 보여 준다. 느리다는 말이 나오면 줄 상태를 캐시하도록 바꾼다
    if (!file?.lines || needed > 20000) return;
    if (colored?.file === file && (colored.lines.length >= needed || colored.lines.length >= file.lines.length)) return;
    let active = true;
    monaco.editor.colorize(file.lines.slice(0, needed + 200).join('\n'), languageOf(file.path), { tabSize: 4 })
      .then((html) => { if (active) setColored({ file, lines: parseColorized(html) }); })
      .catch(() => {});
    return () => { active = false; };
  }, [file, needed, colored]);
  const tokens = colored?.file === file ? colored?.lines : undefined;

  useEffect(() => {
    if (!box.current || !popup) return;
    const el = box.current;
    let width = el.offsetWidth, height = el.offsetHeight;
    const observer = new ResizeObserver(() => {
      if (width === el.offsetWidth && height === el.offsetHeight) return;
      width = el.offsetWidth;
      height = el.offsetHeight;
      setSize({ width, height });
      setPref('size.usagesPopup', { width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [popup]);

  useEffect(() => {
    box.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [popup, index]);

  useEffect(() => {
    setIndex(0);
    setPosition(null);
  }, [popup]);

  useEffect(() => {
    if (!popup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null);
      else if (e.key === 'ArrowDown') setIndex((i) => Math.max(0, Math.min(i + 1, locations.length - 1)));
      else if (e.key === 'ArrowUp') setIndex((i) => Math.max(Math.min(i, locations.length - 1) - 1, 0));
      else if (e.key === 'Enter' && selection && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
        setPopup(null);
        jumpToResult(selection, popup.origin);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.usages-popup')) setPopup(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [popup, selection, setPopup, locations.length]);

  if (!popup) return null;
  const top = Math.min(position?.y ?? popup.y, window.innerHeight - size.height - 8);
  const left = Math.min(position?.x ?? popup.x, window.innerWidth - size.width - 8);
  return (
    <div className="usages-popup" ref={box} style={{ top: Math.max(8, top), left: Math.max(8, left), ...size }}>
      <div
        className="popup-title popup-handle"
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0 || (e.target as HTMLElement).closest('button, label')) return;
          const rect = box.current!.getBoundingClientRect();
          dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          setPosition({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
        }}
      >
        <span className="usages-heading">{popup.title}{popup.references && ` 사용처 ${locations.length}건`}
        {popup.references && <label className="import-filter"><input type="checkbox" checked={hideImports} onChange={toggleImports} /> import 제외</label>}</span>
        <button
          className="link"
          onClick={() => {
            setUsages({ title: popup.title, word: popup.word, locations: popup.locations, origin: popup.origin, basis: popup.origin?.label ?? '워킹트리' });
            setBottomPanel('usages');
            setPopup(null);
          }}
        >
          도구 창에서 보기
        </button>
      </div>
      <div className="popup-list">
        {locations.map((l, i) => (
          <div
            key={`${l.path}:${l.line}:${l.column}`}
            className={`row ${i === selectedIndex ? 'selected' : ''}`}
            onClick={() => setIndex(i)}
            onDoubleClick={() => {
              setPopup(null);
              jumpToResult(l, popup.origin);
            }}
          >
            <span className="loc">{l.path}:{l.line}</span>
            {basisOf(l.path, popup.origin) && (
              <span className="basis-tag" title={basisTitle(l.path === popup.origin?.change?.path ? originDesc : '')}>
                {basisOf(l.path, popup.origin)}
              </span>
            )}
            <span className="preview">{highlight(l.preview, pattern)}</span>
          </div>
        ))}
      </div>
      {selection && <div className="usage-context">
        <div className="popup-title">{selection.path}:{selection.line}
          <button className="link" onClick={() => { setPopup(null); jumpToResult(selection, popup.origin); }}>파일 열기</button>
        </div>
        <pre>{file?.path !== selection.path ? '불러오는 중…' : !file.lines ? '파일을 읽을 수 없습니다.' :
          file.lines.slice(Math.max(0, selection.line - 6), selection.line + 5).map((line, i) => {
            const n = Math.max(1, selection.line - 5) + i;
            const lineTokens = tokens?.[n - 1];
            return <div key={n} className={n === selection.line ? 'reveal-line' : ''}>{String(n).padStart(4)}  {lineTokens
              ? lineTokens.map((t, j) => <span key={j} className={t.cls}>{highlight(t.text, pattern)}</span>)
              : highlight(line, pattern)}</div>;
          })}</pre>
      </div>}
    </div>
  );
}
