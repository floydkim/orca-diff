import { useMemo } from 'react';
import type { Location } from '../../../server/shared/types.ts';
import { highlight, matchPattern } from './FindInFilesPanel.tsx';
import { useSourceDescription } from '../layout/EditorTabs.tsx';
import { basisOf, jumpToResult, useNavUi } from './useNavigation.ts';

// 기준 표시 툴팁: 커밋 기준이면 커밋 제목도 보여 준다
export const basisTitle = (desc: string) => (desc ? `${desc}\n` : '') + '줄 번호도 이 기준입니다';

// 하단 도구 창: 사용처를 파일별 트리로
export function FindUsagesPanel() {
  const { usages, hideImports, toggleImports } = useNavUi();

  const byFile = useMemo(() => {
    const map = new Map<string, Location[]>();
    for (const l of usages?.locations ?? []) {
      if (hideImports && l.isImport) continue;
      map.set(l.path, [...(map.get(l.path) ?? []), l]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [usages, hideImports]);
  const word = usages?.word ?? usages?.title;
  const originDesc = useSourceDescription(usages?.origin?.source ?? null);
  const pattern = useMemo(() => (word ? matchPattern(word, { caseSensitive: true, wholeWord: true, regex: false }) : null), [word]);

  if (!usages) return <div className="empty">TS/JS 코드에서 Alt+F7로 사용처를 찾으세요</div>;
  return (
    <div className="usages-panel">
      <div className="panel-title usages-heading">
        {usages.title} — 사용처 {byFile.reduce((count, [, rows]) => count + rows.length, 0)}건
        {/* diff에서 찾은 결과는 파일마다 기준이 달라 파일 묶음에 표시한다 */}
        {usages.basis && !usages.origin?.source && <span className="meta" title="줄 번호도 이 기준입니다"> · {usages.basis} 기준</span>} <label className="import-filter"><input type="checkbox" checked={hideImports} onChange={toggleImports} /> import 제외</label>
      </div>
      {byFile.map(([path, locs]) => (
        <details key={path} open>
          <summary className="group">
            {path} <span className="count">{locs.length}</span>
            {basisOf(path, usages.origin) && (
              <span className="basis-tag" title={basisTitle(path === usages.origin?.change?.path ? originDesc : '')}>
                {basisOf(path, usages.origin)} 기준
              </span>
            )}
          </summary>
          {locs.map((l) => (
            <div key={`${l.line}:${l.column}`} className="row file" onClick={() => jumpToResult(l, usages.origin)}>
              <span className="meta">{l.line}</span>
              <span className="preview">{highlight(l.preview, pattern)}</span>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
