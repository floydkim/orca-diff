import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { Location } from '../../../server/shared/types.ts';
import { getWorktreeFiles, searchCode } from '../api.ts';
import { editorSelection, highlight, matchPattern, openFindInFiles, SearchOptionButtons, useFindInFiles } from '../nav/FindInFilesPanel.tsx';
import { jumpTo } from '../nav/useNavigation.ts';
import { useStore } from '../store.ts';
import { createDoubleShiftDetector } from './doubleShift.ts';
import { matchIndices, score } from './fileMatch.ts';

const MAX_FILES = 8;
const MAX_CODE = 30;

function highlightPath(path: string, query: string): ReactNode {
  const hit = new Set(matchIndices(path, query));
  if (hit.size === 0) return path;
  return path.split('').map((ch, i) => (hit.has(i) ? <mark key={i}>{ch}</mark> : ch));
}

type Item = { kind: 'file'; path: string } | { kind: 'code'; loc: Location };

// WebStorm의 Search Everywhere처럼 파일 이름과 코드 내용을 한 번에 찾습니다
export function SearchEverywhere() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [fileMessage, setFileMessage] = useState('');
  const [code, setCode] = useState<{ query: string; locations: Location[]; truncated: boolean; error?: string } | null>(null);
  const options = useFindInFiles((s) => s.options);

  const trimmed = query.trim();
  const files = useMemo(
    () =>
      paths
        .map((path) => ({ path, rank: score(path, trimmed.toLowerCase()) }))
        .filter((r) => Number.isFinite(r.rank))
        .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length)
        .slice(0, MAX_FILES),
    [paths, trimmed],
  );
  // 지금 입력과 다른 검색어의 코드 결과는 보이지 않게 합니다
  const codeResult = code?.query === trimmed ? code : null;
  const items: Item[] = useMemo(
    () => [
      ...files.map(({ path }) => ({ kind: 'file' as const, path })),
      ...(codeResult?.locations ?? []).slice(0, MAX_CODE).map((loc) => ({ kind: 'code' as const, loc })),
    ],
    [files, codeResult],
  );
  const pattern = useMemo(() => matchPattern(trimmed, options), [trimmed, options]);

  function open() {
    if (dialog.current?.open) return;
    const selected = editorSelection();
    dialog.current?.showModal();
    if (selected) setQuery(selected);
    setIndex(0);
    setPaths([]);
    setFileMessage('불러오는 중…');
    input.current?.select();
    getWorktreeFiles()
      .then((all) => {
        setPaths(all);
        setFileMessage('');
      })
      .catch((e: Error) => setFileMessage(e.message));
  }

  useEffect(() => {
    const detect = createDoubleShiftDetector();
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        open();
        return;
      }
      if (detect({ type: e.type as 'keydown' | 'keyup', key: e.key, repeat: e.repeat, time: e.timeStamp })) open();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, []);

  // 두 글자 이상이면 입력이 멈춘 뒤 코드 내용도 찾습니다
  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCode(trimmed, options)
        .then((r) => !cancelled && setCode({ query: trimmed, ...r }))
        .catch((e: Error) => !cancelled && setCode({ query: trimmed, locations: [], truncated: false, error: e.message }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, options]);

  useEffect(() => {
    dialog.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  function choose(item: Item) {
    dialog.current?.close();
    if (item.kind === 'file') useStore.getState().openFile(item.path);
    else jumpTo(item.loc);
  }

  function showAllInPanel() {
    dialog.current?.close();
    openFindInFiles(trimmed);
  }

  const codeCount = codeResult ? `${codeResult.locations.length}${codeResult.truncated ? '+' : ''}건` : '';
  const codeStatus = (() => {
    if (trimmed.length < 2) return '두 글자 이상 입력하면 코드 내용도 찾습니다';
    if (!codeResult) return '찾는 중…';
    if (codeResult.error) return codeResult.error;
    return codeResult.locations.length === 0 ? '일치하는 코드 없음' : null;
  })();

  return (
    <>
      <dialog
        ref={dialog}
        className="search-everywhere"
        aria-label="파일·코드 검색"
        onClick={(e) => {
          // 바깥 딤 영역 클릭도 dialog로 들어오므로, 창 사각형 밖일 때만 닫는다(안쪽 여백 클릭은 무시)
          const r = e.currentTarget.getBoundingClientRect();
          if (e.target === e.currentTarget && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) e.currentTarget.close();
        }}
      >
        <div className="search-everywhere-bar">
          <input
            ref={input}
            autoFocus
            aria-label="파일 이름 또는 코드"
            placeholder="파일 이름 또는 코드 (Shift 두 번)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
              else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) showAllInPanel();
              else if (e.key === 'Enter' && items[index]) choose(items[index]);
              else return;
              e.preventDefault();
            }}
          />
          <SearchOptionButtons />
          <button onClick={() => dialog.current?.close()}>닫기</button>
        </div>
        <div className="finder-results">
          <div className="finder-section">파일</div>
          {files.length === 0 && <div className="finder-empty">{fileMessage || '일치하는 파일 없음'}</div>}
          {items.map((item, i) =>
            item.kind === 'file' ? (
              <button key={`f:${item.path}`} aria-current={i === index} onClick={() => choose(item)} onMouseMove={() => setIndex(i)}>
                {highlightPath(item.path, trimmed.toLowerCase())}
              </button>
            ) : null,
          )}
          <div className="finder-section">
            코드 <span className="count">{codeCount}</span>
            {trimmed.length >= 2 && (
              <button className="link" onClick={showAllInPanel} title="Find in Files 도구 창에서 모두 보기 (⌘⏎)">
                모두 보기
              </button>
            )}
          </div>
          {codeStatus && <div className="finder-empty">{codeStatus}</div>}
          {items.map((item, i) =>
            item.kind === 'code' ? (
              <button
                key={`c:${item.loc.path}:${item.loc.line}:${item.loc.column}`}
                className="code-hit"
                aria-current={i === index}
                onClick={() => choose(item)}
                onMouseMove={() => setIndex(i)}
              >
                <span className="preview">{highlight(item.loc.preview, pattern)}</span>
                <span className="meta" title={`${item.loc.path}:${item.loc.line}`}>
                  {item.loc.path.slice(item.loc.path.lastIndexOf('/') + 1)}:{item.loc.line}
                </span>
              </button>
            ) : null,
          )}
        </div>
      </dialog>
    </>
  );
}
