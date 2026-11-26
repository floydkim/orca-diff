import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Location } from '../../../server/shared/types.ts';
import { searchCode, type SearchOptions } from '../api.ts';
import { monaco } from '../monaco/setup.ts';
import { getPref, setPref } from '../prefs.ts';
import { useStore } from '../store.ts';
import { jumpTo } from './useNavigation.ts';

// 도구 창을 닫았다 열어도 검색어와 결과가 남도록 검색 상태를 컴포넌트 밖에 둡니다
export const useFindInFiles = create<{
  query: string;
  options: SearchOptions;
  focusTick: number;
  loading: boolean;
  error: string | null;
  result: { locations: Location[]; truncated: boolean } | null;
}>(() => ({
  query: '',
  options: getPref('searchOptions', { caseSensitive: false, wholeWord: false, regex: false }),
  focusTick: 0,
  loading: false,
  error: null,
  result: null,
}));

// 포커스된 에디터에서 한 줄 이내로 선택한 텍스트입니다. WebStorm처럼 검색어 기본값으로 씁니다.
export function editorSelection(): string {
  const editor = monaco.editor.getEditors().find((e) => e.hasTextFocus());
  const sel = editor?.getSelection();
  if (!sel || sel.isEmpty() || sel.startLineNumber !== sel.endLineNumber) return '';
  return editor?.getModel()?.getValueInRange(sel) ?? '';
}

export function openFindInFiles(query = editorSelection()) {
  useFindInFiles.setState((s) => ({ query: query || s.query, focusTick: s.focusTick + 1 }));
  useStore.getState().setBottomPanel('search');
}

// Cmd+Shift+F로 검색 창을 엽니다. Orca 단축키와 겹칠 때를 위해 Ctrl+Shift+F도 받습니다.
export function useFindInFilesKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        e.stopPropagation();
        openFindInFiles();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

// 미리보기에서 일치한 부분을 강조하기 위한 JS 정규식입니다. git의 PCRE와 문법이 달라 만들 수 없으면 강조하지 않습니다.
export function matchPattern(query: string, o: SearchOptions): RegExp | null {
  const source = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(o.wholeWord ? `\\b(?:${source})\\b` : source, o.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

export function highlight(text: string, pattern: RegExp | null): ReactNode {
  if (!pattern) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m[0].length === 0) continue;
    parts.push(text.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

const OPTION_BUTTONS: { key: keyof SearchOptions; label: string; title: string }[] = [
  { key: 'caseSensitive', label: 'Aa', title: '대소문자 구분' },
  { key: 'wholeWord', label: 'W', title: '단어 단위' },
  { key: 'regex', label: '.*', title: '정규식' },
];

// Find in Files와 Search Everywhere가 함께 쓰는 검색 옵션 토글
export function SearchOptionButtons() {
  const options = useFindInFiles((s) => s.options);
  const toggle = (key: keyof SearchOptions) => {
    const next = { ...options, [key]: !options[key] };
    setPref('searchOptions', next);
    useFindInFiles.setState({ options: next });
  };
  return OPTION_BUTTONS.map(({ key, label, title }) => (
    <button key={key} className={`search-option ${options[key] ? 'active' : ''}`} aria-pressed={options[key]} title={title} onClick={() => toggle(key)}>
      {label}
    </button>
  ));
}

export function FindInFilesPanel() {
  const { query, options, focusTick, loading, error, result } = useFindInFiles();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);

  // 입력이 멈추면 검색합니다. 먼저 보낸 요청의 응답이 늦게 와도 최신 결과를 덮어쓰지 않습니다.
  useEffect(() => {
    if (!query) {
      useFindInFiles.setState({ result: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      useFindInFiles.setState({ loading: true });
      searchCode(query, options)
        .then((r) => !cancelled && useFindInFiles.setState({ result: r, error: null, loading: false }))
        .catch((e: Error) => !cancelled && useFindInFiles.setState({ result: null, error: e.message, loading: false }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, options]);

  const pattern = useMemo(() => matchPattern(query, options), [query, options]);
  // 방향키 선택에 쓰도록 결과마다 화면에 보이는 순서의 번호를 붙입니다
  const { byFile, flat } = useMemo(() => {
    const map = new Map<string, { loc: Location; index: number }[]>();
    const flat: Location[] = [];
    for (const loc of result?.locations ?? []) map.set(loc.path, [...(map.get(loc.path) ?? []), { loc, index: -1 }]);
    for (const rows of map.values()) for (const row of rows) row.index = flat.push(row.loc) - 1;
    return { byFile: [...map.entries()], flat };
  }, [result]);

  useEffect(() => setSelected(0), [result]);
  useEffect(() => {
    const row = panel.current?.querySelector('.row.selected');
    // 파일의 첫 결과면 파일 경로 줄까지 보이게 스크롤합니다
    const header = row?.previousElementSibling?.tagName === 'SUMMARY' ? row.previousElementSibling : null;
    header?.scrollIntoView({ block: 'nearest' });
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // 검색어 입력란이나 결과 목록에 포커스가 있을 때 ↑↓로 고르고 Enter로 이동합니다
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target !== input.current && e.target !== panel.current) return;
    if (e.key === 'ArrowDown') setSelected((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
    else if (e.key === 'ArrowUp') setSelected((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && flat[selected]) jumpTo(flat[selected]);
    else return;
    e.preventDefault();
  };

  const summary = (() => {
    if (error) return <span className="search-error">{error}</span>;
    // 상단 바에 검색 버튼이 없으므로 빠른 검색 단축키를 여기서 알려 준다
    if (!result) return loading ? '검색 중…' : '파일·코드 빠른 검색: Shift 두 번 또는 ⌃P';
    const count = `${byFile.length}개 파일, ${result.locations.length}${result.truncated ? '+' : ''}건`;
    return result.truncated ? `${count} (처음 ${result.locations.length}건만 표시)` : count;
  })();

  return (
    <div ref={panel} className="usages-panel find-in-files" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="search-bar">
        <input
          ref={input}
          aria-label="워크트리 전체에서 찾을 텍스트"
          placeholder="워크트리 전체에서 찾기 (⇧⌘F)"
          value={query}
          onChange={(e) => useFindInFiles.setState({ query: e.target.value })}
        />
        <SearchOptionButtons />
        <span className="search-summary">{summary}</span>
      </div>
      {byFile.map(([path, rows]) => (
        <details key={path} open>
          <summary className="group">
            {path} <span className="count">{rows.length}</span>
          </summary>
          {rows.map(({ loc, index }) => (
            <div
              key={`${loc.line}:${loc.column}`}
              className={`row file ${index === selected ? 'selected' : ''}`}
              onClick={() => {
                setSelected(index);
                jumpTo(loc);
              }}
            >
              <span className="meta">{loc.line}</span>
              <span className="preview">{highlight(loc.preview, pattern)}</span>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
