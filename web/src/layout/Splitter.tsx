import { useRef, useState } from 'react';
import { getPref, setPref } from '../prefs.ts';

const STORAGE_PREFIX = 'orca-review:size:';

// 예전 버전이 브라우저에 저장한 값은 서버 설정이 없을 때만 쓴다
function legacySize(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_PREFIX + id));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function readSize(id: string, fallback: number): number {
  const v = Number(getPref(`size.${id}`, legacySize(id) ?? fallback));
  return v > 0 ? v : fallback;
}

// 드래그로 조절하고 브라우저에 기억하는 패널 크기(px)
export function usePanelSize(id: string, fallback: number) {
  const [size, setSize] = useState(() => readSize(id, fallback));
  const save = (v: number) => {
    setSize(v);
    setPref(`size.${id}`, v);
  };
  return [size, save] as const;
}

interface Props {
  direction: 'vertical' | 'horizontal'; // vertical: 좌우 경계, horizontal: 상하 경계
  size: number;
  onResize: (size: number) => void;
  invert?: boolean; // 아래/오른쪽 패널 크기를 조절할 때
  min?: number;
}

export function Splitter({ direction, size, onResize, invert = false, min = 80 }: Props) {
  const dragStart = useRef({ position: 0, size: 0 });
  return (
    <div
      className={`splitter ${direction}`}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        e.preventDefault();
        dragStart.current = { position: direction === 'vertical' ? e.clientX : e.clientY, size };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const position = direction === 'vertical' ? e.clientX : e.clientY;
        const delta = position - dragStart.current.position;
        onResize(Math.max(min, dragStart.current.size + (invert ? -delta : delta)));
      }}
    />
  );
}
