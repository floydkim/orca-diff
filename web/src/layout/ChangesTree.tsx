import { useEffect, useMemo, useRef, useState } from 'react';
import type { Change, Commit, Source } from '../../../server/shared/types.ts';
import { getChanges, getCommits, reveal } from '../api.ts';
import { copyText, useContextMenu } from '../contextMenu.tsx';
import { formatCommitMessage } from '../feedback/format.ts';
import { openCommitDialog, useFeedback } from '../feedback/storage.ts';
import { commitsSource, sourceKey, useStore } from '../store.ts';
import { buildChangeTree, collectDirPaths, type DirNode } from './changeTree.ts';
import { Splitter, usePanelSize } from './Splitter.tsx';

const POLL_MS = 3000;

interface Group { title: string; source: Source; changes: Change[] }

// 펼침/접힘 꺾쇠 아이콘(접히면 오른쪽, 펼치면 아래)
function Twisty({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className={`twisty ${collapsed ? '' : 'open'}`} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

const INDENT_PX = 14;
const BASE_PX = 8;
const keyOf = (group: string, path: string) => `${group}|${path}`;

interface TreeProps {
  group: Group;
  node: DirNode;
  depth: number;
  collapsed: Set<string>;
  activeDiffPath: string | null;
  toggle: (key: string) => void;
  onOpen: (source: Source, c: Change) => void;
  onMenu: (source: Source, c: Change, e: React.MouseEvent) => void;
}

// 디렉터리 하나와 그 아래(접힌 디렉터리는 내용을 그리지 않는다)
function DirChildren({ group, node, depth, collapsed, activeDiffPath, toggle, onOpen, onMenu }: TreeProps) {
  const pad = (d: number) => ({ paddingLeft: BASE_PX + d * INDENT_PX });
  return (
    <>
      {node.dirs.map((d) => {
        const key = keyOf(group.title, d.path);
        const isCollapsed = collapsed.has(key);
        return (
          <div key={d.path}>
            <div className="row dir" style={pad(depth)} onClick={() => toggle(key)} title={d.path}>
              <Twisty collapsed={isCollapsed} />
              <span className="name">📁 {d.name}</span>
            </div>
            {!isCollapsed && <DirChildren group={group} node={d} depth={depth + 1} collapsed={collapsed} activeDiffPath={activeDiffPath} toggle={toggle} onOpen={onOpen} onMenu={onMenu} />}
          </div>
        );
      })}
      {node.files.map((c) => (
        <div
          key={c.path}
          className={`row file s-${c.status}`}
          aria-current={c.path === activeDiffPath || undefined}
          style={pad(depth + 1)}
          onClick={() => onOpen(group.source, c)}
          onContextMenu={(e) => onMenu(group.source, c, e)}
          title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
        >
          <span className="status">{c.status}</span>
          <span className="name">{c.path.slice(c.path.lastIndexOf('/') + 1)}</span>
        </div>
      ))}
    </>
  );
}

export function ChangesTree() {
  const { selection, openDiff, openFile, refreshTick, toast, tabs, activeTabId } = useStore();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const selectedSha = selection.mode === 'commits' && selection.shas.length === 1 ? selection.shas[0] : null;
  const [commit, setCommit] = useState<Commit>();
  const detail = commit?.sha === selectedSha ? commit : undefined;
  const [detailHeight, setDetailHeight] = usePanelSize('commitDetail', 160);
  const detailBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedSha) return;
    let cancelled = false;
    getCommits({ ref: selectedSha, base: null, skip: 0, limit: 1 })
      .then(([result]) => { if (!cancelled) setCommit(result); })
      .catch((e: Error) => { if (!cancelled) toast(`커밋 상세 조회 실패: ${e.message}`, 'error'); });
    return () => { cancelled = true; };
  }, [selectedSha, toast]);

  const openFileMenu = (source: Source, c: Change, e: React.MouseEvent) => {
    e.preventDefault();
    useContextMenu.getState().open(e.clientX, e.clientY, [
      { label: 'diff 열기', onSelect: () => openDiff(source, c) },
      { label: '현재 워크트리 파일 열기', disabled: source.kind === 'unstaged' && c.status === 'D', onSelect: () => openFile(c.path) },
      'separator',
      { label: '파일에 코멘트', onSelect: () => useFeedback.getState().openDialog({ kind: 'file', source, path: c.path }) },
      'separator',
      { label: '경로 복사', onSelect: () => copyText(c.path, '경로') },
      {
        label: 'Finder에서 보기',
        disabled: source.kind === 'unstaged' && c.status === 'D',
        onSelect: () => reveal(c.path).catch((err: Error) => toast(`Finder에서 열기 실패: ${err.message}`, 'error')),
      },
    ]);
  };
  const [groups, setGroups] = useState<Group[]>([]);
  const lastJson = useRef('');
  // 접힌 그룹·디렉터리(키: '그룹|경로'). 새로고침돼도 경로가 같으면 유지된다.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const [normalCollapsed, setNormalCollapsed] = useState<Set<string>>(new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(new Set());
  const collapsed = query ? searchCollapsed : normalCollapsed;
  const setCollapsed = query ? setSearchCollapsed : setNormalCollapsed;
  const sources = useMemo<{ title: string; source: Source }[]>(() => {
    if (selection.mode === 'worktree') {
      return [
        { title: 'Unstaged', source: { kind: 'unstaged' } },
        { title: 'Staged', source: { kind: 'staged' } },
      ];
    }
    return [{ title: 'Changes', source: commitsSource(selection.shas) }];
  }, [selection]);

  const trees = useMemo(() => {
    const currentGroups = groups.filter(({ source }) => sources.some((entry) => sourceKey(entry.source) === sourceKey(source)));
    return currentGroups.map((group) => {
      const changes = group.changes.filter(({ path }) => {
        const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
        if (query.startsWith('*.')) return name.endsWith(query.slice(1));
        return query.startsWith('.') ? name.endsWith(query) : name.includes(query);
      });
      return { group: { ...group, changes }, tree: buildChangeTree(changes) };
    });
  }, [groups, query, sources]);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const collapseAll = () => setCollapsed(new Set(trees.flatMap(({ group, tree }) => collectDirPaths(tree).map((p) => keyOf(group.title, p)))));
  const expandAll = () => setCollapsed(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await Promise.all(sources.map(async (s) => ({ ...s, changes: await getChanges(s.source) })));
        const json = JSON.stringify(result);
        // 결과가 같으면 상태를 바꾸지 않는다(폴링 중 불필요한 렌더 방지)
        if (!cancelled && json !== lastJson.current) {
          lastJson.current = json;
          setGroups(result);
        }
      } catch (e) {
        if (!cancelled) toast(`변경 목록 실패: ${(e as Error).message}`, 'error');
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const timer = selection.mode === 'worktree' ? setInterval(load, POLL_MS) : null;
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      if (timer) clearInterval(timer);
    };
  }, [sources, selection.mode, refreshTick, toast]);

  return (
    <div className="changes-tree">
      {searchOpen ? (
        <div className="panel-title panel-search">
          <input
            autoFocus
            aria-label="변경 파일 필터" placeholder="파일명 또는 확장자 (예: .svg)"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setSearchCollapsed(new Set()); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('');
                setSearchOpen(false);
              }
            }}
          />
          <button
            className="icon-button small"
            title="필터 닫기 (Esc)"
            aria-label="필터 닫기"
            onClick={() => {
              setFilter('');
              setSearchOpen(false);
            }}
          >
            ×
          </button>
        </div>
      ) : (
      <div className="panel-title panel-title-row">
        <span>Changes</span>
        <span className="panel-actions">
          <button className="icon-button small" title="모두 접기" aria-label="모두 접기" onClick={collapseAll}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="currentColor" d="M10.896 2H8.75V.75a.75.75 0 0 0-1.5 0V2H5.104a.25.25 0 0 0-.177.427l2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 2ZM8.75 15.25a.75.75 0 0 1-1.5 0V14H5.104a.25.25 0 0 1-.177-.427l2.896-2.896a.25.25 0 0 1 .354 0l2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25Zm-6.5-6.5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z" />
            </svg>
          </button>
          <button className="icon-button small" title="모두 열기" aria-label="모두 열기" onClick={expandAll}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="currentColor" d="m8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z" />
            </svg>
          </button>
          <button
            className={`icon-button small ${filter ? 'active' : ''}`}
            title="변경 파일 필터"
            aria-label="변경 파일 필터"
            onClick={() => setSearchOpen(true)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"
              />
            </svg>
          </button>
        </span>
      </div>
      )}
      {detail ? (
        <details className="changes-selection" key={detail.sha} open>
          <summary title={detail.subject}>{detail.subject}</summary>
          <div className="commit-detail" ref={detailBox} style={{ maxHeight: detailHeight }}>
            <div className="commit-detail-who">
              <code>{detail.sha.slice(0, 7)}</code> · <code>{detail.author} &lt;{detail.email}&gt;</code>
            </div>
            <pre>{formatCommitMessage(detail)}</pre>
            <div className="commit-detail-footer">
              <span className="meta">{new Date(detail.time * 1000).toLocaleString('ko-KR')}</span>
              <button onClick={() => openCommitDialog(detail)}>💬 커밋에 코멘트</button>
            </div>
          </div>
          {/* 메시지가 짧으면 내용만큼만 차지하므로, 드래그는 지금 보이는 높이에서 시작한다 */}
          <Splitter direction="horizontal" size={Math.min(detailHeight, detailBox.current?.offsetHeight ?? detailHeight)} onResize={setDetailHeight} min={40} />
        </details>
      ) : (
        <div className="changes-selection">
          {selection.mode === 'worktree' ? 'Working tree' : `커밋 ${selection.shas.length}개`}
        </div>
      )}
      <div className="list">
        {trees.map(({ group: g, tree }) => {
          const groupKey = keyOf(g.title, '');
          const groupCollapsed = collapsed.has(groupKey);
          const activeDiffPath = activeTab?.kind === 'diff' && sourceKey(activeTab.source) === sourceKey(g.source)
            ? activeTab.change.path
            : null;
          return (
            <div key={g.title}>
              <div className="row group" onClick={() => toggle(groupKey)}>
                <Twisty collapsed={groupCollapsed} />
                {g.title} <span className="count">{g.changes.length}</span>
              </div>
              {!groupCollapsed && (
                <DirChildren group={g} node={tree} depth={0} collapsed={collapsed} activeDiffPath={activeDiffPath} toggle={toggle} onOpen={openDiff} onMenu={openFileMenu} />
              )}
              {!groupCollapsed && g.changes.length === 0 && <div className="empty">{query ? "일치하는 파일 없음" : "변경 없음"}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
