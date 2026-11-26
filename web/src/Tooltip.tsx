import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const SHOW_DELAY_MS = 400;
const OFFSET_X = 12;
const OFFSET_Y = 18;
const MARGIN = 8;

// title 속성의 툴팁을 앱이 직접 그린다(Orca 내장 브라우저는 OS 기본 툴팁을 띄우지 않음).
// 처음 올라갈 때 title을 data-tip으로 옮겨 기본 툴팁과 겹치지 않게 하고, 커서 위치 기준으로 띄운다.
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    let mouse = { x: 0, y: 0 };

    const hide = () => {
      clearTimeout(timer);
      current = null;
      shown.current = false;
      setTip(null);
    };

    // 커서가 멈춘 뒤에 뜨도록, 움직이면 타이머를 다시 건다
    const schedule = () => {
      clearTimeout(timer);
      const el = current;
      if (!el) return;
      timer = setTimeout(() => {
        const text = el.getAttribute('data-tip');
        if (current === el && el.isConnected && text) {
          shown.current = true;
          setTip({ text, x: mouse.x, y: mouse.y });
        }
      }, SHOW_DELAY_MS);
    };

    const onMove = (e: MouseEvent) => {
      mouse = { x: e.clientX, y: e.clientY };
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[title], [data-tip]') ?? null;
      if (el !== current) {
        hide();
        if (!el) return;
        const title = el.getAttribute('title');
        if (title) {
          el.setAttribute('data-tip', title);
          el.removeAttribute('title');
        }
        if (!el.getAttribute('data-tip')) return;
        current = el;
        schedule();
      } else if (!shown.current) {
        // 같은 요소 안에서 움직이는 중이면 멈출 때까지 기다린다(이미 떴으면 그대로 둔다)
        schedule();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', hide);
    window.addEventListener('mousedown', hide, true);
    window.addEventListener('wheel', hide, true);
    window.addEventListener('keydown', hide, true);
    return () => {
      hide();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', hide);
      window.removeEventListener('mousedown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('keydown', hide, true);
    };
  }, []);

  // 그린 뒤 크기를 재서 화면 밖으로 나가면 안쪽으로 밀어 넣는다(아래가 모자라면 커서 위로)
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !tip) return;
    // 모달 <dialog>는 top layer에 있어 z-index로는 위에 못 올라가므로, 툴팁도 popover로 top layer에 올린다.
    // 띄우기 전의 popover는 display: none이라 크기가 0이므로 먼저 띄우고 잰다
    if (!box.matches(':popover-open')) box.showPopover();
    const { width, height } = box.getBoundingClientRect();
    const left = Math.min(tip.x + OFFSET_X, window.innerWidth - width - MARGIN);
    const below = tip.y + OFFSET_Y;
    const top = below + height + MARGIN > window.innerHeight ? tip.y - height - MARGIN : below;
    box.style.left = `${Math.max(MARGIN, left)}px`;
    box.style.top = `${Math.max(MARGIN, top)}px`;
    box.style.visibility = 'visible';
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={boxRef} className="tooltip" popover="manual" style={{ left: 0, top: 0, visibility: 'hidden' }} role="tooltip">
      {tip.text}
    </div>
  );
}
