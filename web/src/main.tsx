import './monaco/setup.ts';
import { loadThemeMode } from './settings/theme.ts';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KEY, WT } from './api.ts';
import { loadPrefs } from './prefs.ts';

const root = createRoot(document.getElementById('root')!);

async function start() {
  if (!KEY || !WT) {
    root.render(<div className="editor-empty">터미널에서 orca-diff로 여세요 (key/wt 없음)</div>);
    return;
  }
  // 패널 크기·글꼴 등 설정을 먼저 읽은 뒤 앱 모듈을 불러온다(모듈 초기화 때 설정을 읽음)
  await loadPrefs();
  loadThemeMode();
  const [{ App }, { preloadComments }] = await Promise.all([import('./App.tsx'), import('./feedback/storage.ts')]);
  const { useStore } = await import('./store.ts');
  const { useNavUi } = await import('./nav/useNavigation.ts');
  const key = 'review-session.v1:' + WT;
  function snapshot() {
    const { branch, baseOnly, filter, selection, tabs, activeTabId, bottomPanel, navBack, navForward } = useStore.getState();
    return { branch, baseOnly, filter, selection, tabs, activeTabId, bottomPanel, navBack, navForward, usages: useNavUi.getState().usages };
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { usages, ...state } = JSON.parse(raw) as ReturnType<typeof snapshot>;
      useStore.setState(state);
      useNavUi.setState({ usages });
    }
  } catch { /* 저장소를 사용할 수 없으면 기본 화면을 연다. */ }
  window.addEventListener('pagehide', () => {
    try { localStorage.setItem(key, JSON.stringify(snapshot())); } catch { /* 저장 공간 부족 */ }
  });
  await preloadComments();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

start();
