import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from '../web/src/store.ts';

const open = () => ['a.ts', 'b.ts', 'c.ts'].forEach((p) => useStore.getState().openFile(p));
const ids = () => useStore.getState().tabs.map((t) => t.id);

beforeEach(() => useStore.setState({ tabs: [], activeTabId: null }));

describe('탭 닫기', () => {
  test('다른 탭 모두 닫기는 그 탭만 남기고 활성화한다', () => {
    open();
    useStore.getState().closeOthers('file:b.ts');
    expect(ids()).toEqual(['file:b.ts']);
    expect(useStore.getState().activeTabId).toBe('file:b.ts');
  });

  test('모든 탭 닫기', () => {
    open();
    useStore.getState().closeAll();
    expect(ids()).toEqual([]);
    expect(useStore.getState().activeTabId).toBeNull();
  });
});

describe('diff 탭 줄 이동', () => {
  const source = { kind: 'commits', from: 'abc', to: 'abc' } as const;
  const change = { path: 'a.ts', status: 'M', binary: false } as const;
  const diffId = () => useStore.getState().tabs.find((t) => t.kind === 'diff')!.id;
  const reveal = () => {
    const tab = useStore.getState().tabs.find((t) => t.kind === 'diff');
    return tab?.kind === 'diff' ? tab.reveal : undefined;
  };

  test('revealDiff는 그 탭을 활성화하고, 같은 줄이어도 매번 새 이동 요청을 넣는다', () => {
    useStore.getState().openDiff(source, change);
    useStore.getState().openFile('b.ts');
    useStore.getState().revealDiff(diffId(), { line: 3, column: 1 });
    const first = reveal();
    expect(useStore.getState().activeTabId).toBe(diffId());
    expect(first).toEqual({ line: 3, column: 1 });
    useStore.getState().revealDiff(diffId(), { line: 3, column: 1 });
    expect(reveal()).not.toBe(first);
  });

  test('뒤로 가기로 diff 탭에 돌아오면 기록된 줄로 이동한다', () => {
    useStore.getState().openDiff(source, change);
    useStore.getState().revealNav({ path: 'a.ts', line: 7, column: 2, tabId: diffId() });
    expect(reveal()).toEqual({ line: 7, column: 2 });
  });
});
