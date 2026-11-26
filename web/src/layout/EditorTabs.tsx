import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Source } from '../../../server/shared/types.ts';
import { getCommits } from '../api.ts';
import { useContextMenu } from '../contextMenu.tsx';
import { type Tab, useStore } from '../store.ts';

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function tabTitle(tab: Tab): string {
  return tab.kind === 'diff' ? baseName(tab.change.path) : baseName(tab.path);
}

// 같은 이름의 diff 탭을 구분하는 짧은 기준
function sourceTag(s: Source): string {
  if (s.kind !== 'commits') return s.kind;
  return s.from === s.to ? s.to.slice(0, 7) : `${s.from.slice(0, 7)}..${s.to.slice(0, 7)}`;
}

// 툴팁에 넣을 커밋 제목. 탭에는 해시만 있으므로 보일 때 조회해 기억해 둔다.
const subjects = new Map<string, Promise<string>>();
function subjectOf(sha: string): Promise<string> {
  if (!subjects.has(sha)) {
    subjects.set(sha, getCommits({ ref: sha, base: null, skip: 0, limit: 1 }).then((c) => c[0]?.subject ?? sha.slice(0, 7), () => sha.slice(0, 7)));
  }
  return subjects.get(sha)!;
}

export function useSourceDescription(s: Source | null): string {
  const [text, setText] = useState('');
  const key = s ? JSON.stringify(s) : '';
  useEffect(() => {
    if (!s) return;
    if (s.kind !== 'commits') return setText(s.kind === 'staged' ? 'Staged 변경' : 'Unstaged 변경');
    let active = true;
    const shas = s.from === s.to ? [s.to] : [s.from, s.to];
    Promise.all(shas.map(subjectOf)).then(([first, last]) => {
      if (active) setText(last === undefined ? `커밋: ${first}` : `커밋 범위: ${first} … ${last}`);
    });
    return () => { active = false; };
    // source 객체는 렌더마다 새로 만들어질 수 있어 내용(key)으로 비교한다
  }, [key]);
  return text;
}

function TabLabel({ tab, showTag }: { tab: Tab; showTag: boolean }) {
  const desc = useSourceDescription(tab.kind === 'diff' ? tab.source : null);
  const path = tab.kind === 'diff' ? tab.change.path : tab.path;
  return (
    <span className="tab-label" title={desc ? `${path}\n${desc}` : path}>
      {tab.kind === 'diff' ? '◐ ' : ''}
      {tabTitle(tab)}
      {showTag && tab.kind === 'diff' && <span className="tab-tag">{sourceTag(tab.source)}</span>}
    </span>
  );
}

interface Props {
  renderTab: (tab: Tab) => ReactNode;
  tabActions?: (tab: Tab) => ReactNode;
}

// 탭은 모두 마운트해 두고 비활성 탭은 숨긴다(스크롤 위치·에디터 상태 유지)
export function EditorTabs({ renderTab, tabActions }: Props) {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOthers, closeAll } = useStore();
  const barRef = useRef<HTMLDivElement>(null);
  const diffTitleCount = new Map<string, number>();
  for (const t of tabs) if (t.kind === 'diff') diffTitleCount.set(tabTitle(t), (diffTitleCount.get(tabTitle(t)) ?? 0) + 1);

  // 스크롤바를 숨겼으므로 활성 탭이 가려져 있으면 보이게 스크롤한다
  useEffect(() => {
    barRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  const openTabMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    useContextMenu.getState().open(e.clientX, e.clientY, [
      { label: '이 탭 닫기', onSelect: () => closeTab(id) },
      { label: '다른 탭 모두 닫기', disabled: tabs.length < 2, onSelect: () => closeOthers(id) },
      { label: '모든 탭 닫기', onSelect: closeAll },
    ]);
  };

  if (tabs.length === 0) {
    return <div className="editor-empty">왼쪽에서 커밋과 파일을 선택하세요</div>;
  }
  return (
    <div className="editor-tabs">
      <div
        className="tab-bar"
        ref={barRef}
        onWheel={(e) => {
          // 세로 휠을 가로 스크롤로(트랙패드 가로 스와이프는 그대로)
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
            onContextMenu={(e) => openTabMenu(t.id, e)}
          >
            <TabLabel tab={t} showTag={t.kind === 'diff' && (diffTitleCount.get(tabTitle(t)) ?? 0) > 1} />
            {tabActions?.(t)}
            <button
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tab-content">
        {tabs.map((t) => (
          <div key={t.id} className="tab-pane" style={{ display: t.id === activeTabId ? 'flex' : 'none' }}>
            {renderTab(t)}
          </div>
        ))}
      </div>
    </div>
  );
}
