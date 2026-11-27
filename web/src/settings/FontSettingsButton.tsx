import { useEffect, useMemo, useState } from 'react';
import { useFeedbackSubmit } from './feedbackSubmit.ts';
import { detectInstalledFonts, useFontSettings } from './fontSettings.ts';
import { type SidebarPosition, useSidebarLayout } from './sidebarLayout.ts';
import { type ThemeMode, useThemeMode } from './theme.ts';

const THEME_OPTIONS: [ThemeMode, string][] = [
  ['system', '시스템'],
  ['light', '라이트'],
  ['dark', '다크'],
];
// 자동: 창 너비가 900px보다 좁으면 하단
const SIDEBAR_OPTIONS: [SidebarPosition, string][] = [
  ['auto', '자동'],
  ['left', '왼쪽'],
  ['bottom', '하단'],
];

// 상단 바의 ⚙ 버튼과 설정 팝오버(테마, 뷰어 글꼴, 피드백 전송 방식)
export function FontSettingsButton() {
  const { family, size, set } = useFontSettings();
  const [open, setOpen] = useState(false);
  const { submit, setSubmit } = useFeedbackSubmit();
  const { mode, setMode } = useThemeMode();
  const sidebar = useSidebarLayout();
  const installed = useMemo(() => (open ? detectInstalledFonts() : []), [open]);
  const fonts = installed.includes(family) ? installed : [family, ...installed];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.font-settings')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="font-settings">
      <button className="icon-button" title="설정" aria-label="설정" onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"
          />
        </svg>
      </button>
      {open && (
        <div className="font-popover">
          <div className="popover-title">테마</div>
          <div className="toggle">
            {THEME_OPTIONS.map(([value, label]) => (
              <button key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => setMode(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className="popover-title">사이드바 위치</div>
          <div className="toggle">
            {SIDEBAR_OPTIONS.map(([value, label]) => (
              <button key={value} className={sidebar.position === value ? 'active' : ''} aria-pressed={sidebar.position === value} onClick={() => sidebar.setPosition(value)}>
                {label}
              </button>
            ))}
          </div>
          <label title="자동이면 창 너비가 900px보다 좁을 때 하단으로 내립니다">
            <input type="checkbox" checked={sidebar.belowTools} onChange={(e) => sidebar.setBelowTools(e.target.checked)} />
            하단 배치에서 도구 창을 Commits 위에 두기
          </label>
          <div className="popover-title">뷰어 글꼴</div>
          <label>
            글꼴
            <select value={family} onChange={(e) => set({ family: e.target.value })}>
              {fonts.map((f) => (
                <option key={f} value={f} style={{ fontFamily: `"${f}", monospace` }}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label>
            크기
            <input type="number" min={10} max={24} value={size} onChange={(e) => set({ size: Number(e.target.value) })} />
            px
          </label>
          <div className="font-preview" style={{ fontFamily: `"${family}", monospace`, fontSize: size }}>
            {'const add = (a, b) => a + b; // 0Oo 1lI'}
          </div>
          <div className="popover-title">피드백 전송</div>
          <label>
            <input
              type="checkbox"
              checked={submit}
              onChange={(e) => setSubmit(e.target.checked)}
            />
            입력창에 넣고 바로 제출(Enter)
          </label>
        </div>
      )}
    </div>
  );
}
