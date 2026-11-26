import { SearchEverywhere } from './SearchEverywhere.tsx';
import { useEffect, useState } from 'react';
import { type Branches, getBranches, getWorktrees, HOST, KEY, WT } from '../api.ts';
import { FontSettingsButton } from '../settings/FontSettingsButton.tsx';
import { useStore } from '../store.ts';

interface Props {
  leftPaneVisible: boolean;
  onToggleLeftPane: () => void;
  atBottom: boolean; // 사이드바가 하단에 있으면 숨기기 버튼 아이콘을 그에 맞춘다
}

export function TopBar({ leftPaneVisible, onToggleLeftPane, atBottom }: Props) {
  const { branch, base, setBranch, toast } = useStore();
  const [worktrees, setWorktrees] = useState<{ path: string; branch: string | null }[]>([]);
  const [branches, setBranches] = useState<Branches | null>(null);

  useEffect(() => {
    getWorktrees().then(setWorktrees).catch((e: Error) => toast(`워크트리 목록 실패: ${e.message}`, 'error'));
    getBranches()
      .then((b) => {
        setBranches(b);
        const saved = useStore.getState().branch;
        if (saved && (saved === (b.current ?? 'HEAD') || b.local.includes(saved) || b.remote.includes(saved))) {
          useStore.setState({ base: b.base });
        } else {
          setBranch(b.current ?? 'HEAD', b.base);
        }
      })
      .catch((e: Error) => toast(`브랜치 목록 실패: ${e.message}`, 'error'));
  }, [setBranch, toast]);

  const switchWorktree = (path: string) => {
    location.search = `?${new URLSearchParams({ key: KEY, wt: path, ...(HOST ? { host: HOST } : {}) })}`;
  };
  const leftPaneLabel = leftPaneVisible ? '사이드바 숨기기' : '사이드바 보이기';

  return (
    <div className="topbar">
      <button
        type="button"
        className="icon-button"
        title={leftPaneLabel}
        aria-label={leftPaneLabel}
        aria-expanded={leftPaneVisible}
        aria-controls="left-pane"
        onClick={onToggleLeftPane}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d={atBottom ? 'M2 9.5h12' : 'M6 3v10'} />
        </svg>
      </button>
      <label>
        워크트리
        <select value={WT} onChange={(e) => switchWorktree(e.target.value)}>
          {worktrees.length === 0 && <option value={WT}>{WT}</option>}
          {worktrees.map((w) => (
            <option key={w.path} value={w.path}>
              {w.branch ?? '(detached)'} — {w.path}
            </option>
          ))}
        </select>
      </label>
      <label>
        브랜치
        <select value={branch ?? ''} onChange={(e) => setBranch(e.target.value, base)}>
          {branches?.current === null && <option value="HEAD">HEAD (detached)</option>}
          <optgroup label="Local">
            {branches?.local.map((b) => <option key={b} value={b}>{b}</option>)}
          </optgroup>
          <optgroup label="Remote">
            {branches?.remote.map((b) => <option key={b} value={b}>{b}</option>)}
          </optgroup>
        </select>
      </label>
      <span className="topbar-spacer" />
      <SearchEverywhere />
      <FontSettingsButton />
    </div>
  );
}
