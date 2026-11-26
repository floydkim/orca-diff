import { create } from 'zustand';
import { getPref, setPref } from '../prefs.ts';

export type SidebarPosition = 'auto' | 'left' | 'bottom';

// 사이드바(Commits·Changes) 위치와, 하단일 때 도구 창 아래에 둘지. 설정 팝오버와 App이 함께 본다.
export const useSidebarLayout = create<{
  position: SidebarPosition;
  belowTools: boolean;
  setPosition(v: SidebarPosition): void;
  setBelowTools(v: boolean): void;
}>((set) => ({
  position: getPref('sidebarPosition', 'auto'),
  belowTools: getPref('sidebarBelowTools', false),
  setPosition: (position) => {
    set({ position });
    setPref('sidebarPosition', position, { immediate: true });
  },
  setBelowTools: (belowTools) => {
    set({ belowTools });
    setPref('sidebarBelowTools', belowTools, { immediate: true });
  },
}));
