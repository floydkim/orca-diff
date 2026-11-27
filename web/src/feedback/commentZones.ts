import type { Change, Source } from '../../../server/shared/types.ts';
import { monaco } from '../monaco/setup.ts';
import { sourceKey } from '../store.ts';
import { relocate } from './anchor.ts';
import type { ReviewComment } from './model.ts';
import { useFeedback } from './storage.ts';

type Side = 'old' | 'new';
type LineComment = ReviewComment & { target: Extract<ReviewComment['target'], { kind: 'line' }> };

interface Ctx {
  source: Source;
  change: Change;
  editors: Record<Side, monaco.editor.ICodeEditor>;
  contents: Record<Side, string>;
  // 새 파일/삭제 파일처럼 한쪽만 보여줄 때 그 쪽만(기본: 양쪽)
  sides?: Side[];
}

const composers = new Map<string, Composer>();
// 박스 높이(px): 내용 글꼴은 UI 13px 고정이라 에디터 글꼴 크기와 무관
const BODY_LINE_PX = 19;
const COMMENT_BASE_PX = 58;
const COMPOSER_PX = 168;

function isFor(c: ReviewComment, ctx: Ctx): c is LineComment {
  return c.target.kind === 'line' && c.target.path === ctx.change.path && sourceKey(c.target.source) === sourceKey(ctx.source);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// view zone 안의 입력이 에디터 단축키·선택으로 새지 않게 막는다
function isolate(node: HTMLElement) {
  for (const type of ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel', 'paste', 'copy']) {
    node.addEventListener(type, (e) => e.stopPropagation());
  }
}

interface Composer { side: Side; startLine: number; endLine: number; editId?: string; body: string }

// diff의 양쪽 에디터에 라인 코멘트를 그리고, 라인 번호 클릭/드래그로 새 코멘트를 받는다
export interface CommentsHandle extends monaco.IDisposable {
  openComposer(side: Side, startLine: number, endLine: number): void;
}

export function attachComments(ctx: Ctx): CommentsHandle {
  const sides: Side[] = ctx.sides ?? ['old', 'new'];
  const zoneIds: Record<Side, string[]> = { old: [], new: [] };
  const zoneNodes: Record<Side, HTMLElement[]> = { old: [], new: [] };
  // 입력 중인 코멘트는 탭 단위로 보관해 diff가 다시 로드(재부착)돼도 유지한다
  let paintComposerRange = () => {};
  const composerKey = `${sourceKey(ctx.source)}:${ctx.change.path}`;
  let composer: Composer | null = composers.get(composerKey) ?? null;
  const setComposer = (next: Composer | null) => {
    composer = next;
    if (next) composers.set(composerKey, next);
    else composers.delete(composerKey);
  };

  // view zone은 스크롤 폭 전체로 펼쳐지므로, 박스를 보이는 본문 폭에 맞춰야 Split 보기에서 반대쪽 패널에 가려지지 않는다
  const fitWidth = (side: Side, node: HTMLElement) => {
    const { contentWidth, verticalScrollbarWidth } = ctx.editors[side].getLayoutInfo();
    node.style.width = `${Math.max(160, Math.min(640, contentWidth - verticalScrollbarWidth - 24))}px`;
  };

  const clearZones = () => {
    for (const side of sides) {
      ctx.editors[side].changeViewZones((acc) => zoneIds[side].forEach((id) => acc.removeZone(id)));
      zoneIds[side] = [];
      zoneNodes[side] = [];
    }
  };

  const addZone = (side: Side, afterLineNumber: number, domNode: HTMLElement, heightInPx: number) => {
    isolate(domNode);
    fitWidth(side, domNode);
    domNode.style.translate = `${ctx.editors[side].getScrollLeft()}px`;
    zoneNodes[side].push(domNode);
    // Monaco가 zone의 바깥 노드 폭을 100%로 덮어쓰므로 폭은 안쪽 박스에 준다
    const outer = el('div', 'comment-zone-outer');
    outer.append(domNode);
    ctx.editors[side].changeViewZones((acc) => {
      // suppressMouseDown: Monaco가 zone 위 클릭을 텍스트 선택으로 가져가지 않게 한다
      zoneIds[side].push(acc.addZone({ afterLineNumber, heightInPx, domNode: outer, suppressMouseDown: true }));
    });
  };

  const commentNode = (c: LineComment) => {
    const box = el('div', 'comment-zone');
    box.append(el('div', 'comment-body', c.body));
    const actions = el('div', 'comment-actions');
    const edit = el('button', '', '편집');
    edit.onclick = () => {
      setComposer({ side: c.target.side, startLine: c.target.startLine, endLine: c.target.endLine, editId: c.id, body: c.body });
      render();
    };
    const del = el('button', '', '삭제');
    del.onclick = () => useFeedback.getState().remove(c.id);
    if (c.sentAt) actions.append(el('span', 'sent', '보냄'));
    actions.append(edit, del);
    box.append(actions);
    return box;
  };

  const composerNode = (cmp: Composer) => {
    const box = el('div', 'comment-zone composer');
    const range = cmp.startLine === cmp.endLine ? `${cmp.startLine}` : `${cmp.startLine}-${cmp.endLine}`;
    box.append(el('div', 'comment-label', `${cmp.side === 'old' ? '삭제된 코드' : ''} ${range}행 코멘트 (Cmd+Enter 저장, Esc 취소)`.trim()));
    const textarea = el('textarea', 'comment-input');
    textarea.value = cmp.body;
    // 다시 그려져도 입력 중인 내용이 남도록
    textarea.addEventListener('input', () => {
      cmp.body = textarea.value;
    });
    const save = () => {
      const body = textarea.value.trim();
      if (!body) return;
      const { add, update } = useFeedback.getState();
      if (cmp.editId) update(cmp.editId, { body });
      else {
        const excerpt = ctx.contents[cmp.side].split('\n').slice(cmp.startLine - 1, cmp.endLine).join('\n');
        add({ kind: 'line', source: ctx.source, path: ctx.change.path, side: cmp.side, startLine: cmp.startLine, endLine: cmp.endLine, excerpt }, body);
      }
      setComposer(null);
      render();
    };
    const cancel = () => {
      setComposer(null);
      render();
    };
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
      else if (e.key === 'Escape') cancel();
    });
    const actions = el('div', 'comment-actions');
    const ok = el('button', 'primary', '저장');
    ok.onclick = save;
    const no = el('button', '', '취소');
    no.onclick = cancel;
    actions.append(ok, no);
    box.append(textarea, actions);
    // view zone은 다음 렌더 프레임에 DOM에 붙으므로 붙은 뒤에 포커스한다
    const focusWhenAttached = (tries: number) => {
      if (textarea.isConnected) textarea.focus();
      else if (tries > 0) requestAnimationFrame(() => focusWhenAttached(tries - 1));
    };
    requestAnimationFrame(() => focusWhenAttached(20));
    return box;
  };

  function render() {
    clearZones();
    for (const c of useFeedback.getState().comments) {
      if (!isFor(c, ctx) || c.stale || c.id === composer?.editId || !sides.includes(c.target.side)) continue;
      addZone(c.target.side, c.target.endLine, commentNode(c), COMMENT_BASE_PX + BODY_LINE_PX * Math.max(1, c.body.split('\n').length));
    }
    if (composer) addZone(composer.side, composer.endLine, composerNode(composer), COMPOSER_PX);
    paintComposerRange();
  }

  // 내용이 바뀌었으면 발췌로 위치를 다시 찾고, 못 찾으면 stale로 표시
  const { comments, update } = useFeedback.getState();
  for (const c of comments) {
    if (!isFor(c, ctx)) continue;
    const found = relocate(c.target.excerpt, ctx.contents[c.target.side], c.target.startLine);
    if (!found) {
      if (!c.stale) update(c.id, { stale: true });
    } else if (c.stale || found.startLine !== c.target.startLine) {
      update(c.id, { stale: false, target: { ...c.target, ...found } });
    }
  }

  // 라인 번호 영역: 호버하면 + 버튼, 드래그·Shift+클릭으로 코멘트 범위를 노란색으로 표시하고 놓으면 입력창을 연다
  const T = monaco.editor.MouseTargetType;
  const GUTTER = new Set([T.GUTTER_LINE_NUMBERS, T.GUTTER_GLYPH_MARGIN, T.GUTTER_LINE_DECORATIONS]);
  // Monaco의 펼침/접힘 컨트롤(숨긴 줄 위젯, 펼친 구간을 다시 접는 버튼, 코드 접기) 위 클릭은 라인 선택이 아니다
  const MONACO_CONTROLS = '.overlayWidgets, .diff-hidden-lines, .diff-hidden-lines-compact, .diff-hidden-lines-disclosure, .fold-unchanged, [class*="codicon-folding-"]';
  const onGutter = (e: monaco.editor.IEditorMouseEvent) =>
    GUTTER.has(e.target.type) && !(e.event.browserEvent.target as HTMLElement | null)?.closest(MONACO_CONTROLS);
  const hoverDeco = { old: ctx.editors.old.createDecorationsCollection(), new: ctx.editors.new.createDecorationsCollection() };
  const rangeDeco = { old: ctx.editors.old.createDecorationsCollection(), new: ctx.editors.new.createDecorationsCollection() };
  let drag: { side: Side; anchor: number; current: number } | null = null;
  let shiftAnchor: { side: Side; line: number } | null = null;

  const paintRange = (side: Side, a: number, b: number) => {
    rangeDeco[side].set([
      {
        range: new monaco.Range(Math.min(a, b), 1, Math.max(a, b), 1),
        // zIndex: diff의 추가/삭제 줄 배경보다 위에 칠한다
        options: { isWholeLine: true, className: 'comment-range-line', marginClassName: 'comment-range-margin', zIndex: 100 },
      },
    ]);
  };
  paintComposerRange = () => {
    rangeDeco.old.clear();
    rangeDeco.new.clear();
    if (composer) paintRange(composer.side, composer.startLine, composer.endLine);
  };

  // 드래그 중에는 Monaco가 포인터를 잡고 있어 에디터 mousemove가 오지 않으므로 window에서 좌표로 라인을 찾는다
  const onDragMove = (ev: MouseEvent) => {
    if (!drag) return;
    const line = ctx.editors[drag.side].getTargetAtClientPoint(ev.clientX, ev.clientY)?.position?.lineNumber;
    if (line && line !== drag.current) {
      drag.current = line;
      paintRange(drag.side, drag.anchor, line);
    }
  };

  const finishDrag = () => {
    window.removeEventListener('mousemove', onDragMove);
    if (!drag) return;
    const { side, anchor, current } = drag;
    drag = null;
    const editor = ctx.editors[side];
    editor.getDomNode()?.classList.remove('gutter-dragging');
    // Monaco가 만든 텍스트 선택은 지운다(코멘트 범위는 노란색으로 따로 표시)
    editor.setSelection(new monaco.Selection(current, 1, current, 1));
    setComposer({ side, startLine: Math.min(anchor, current), endLine: Math.max(anchor, current), body: '' });
    render();
  };

  const gutterListeners = sides.flatMap((side) => {
    const editor = ctx.editors[side];
    return [
      editor.onMouseDown((e) => {
        const line = e.target.position?.lineNumber;
        if (!onGutter(e) || !line || !e.event.leftButton) return;
        const anchor = e.event.shiftKey && shiftAnchor?.side === side ? shiftAnchor.line : line;
        shiftAnchor = { side, line: anchor };
        drag = { side, anchor, current: line };
        editor.getDomNode()?.classList.add('gutter-dragging');
        paintRange(side, anchor, line);
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', finishDrag, { once: true });
      }),
      editor.onMouseMove((e) => {
        const line = e.target.position?.lineNumber;
        hoverDeco[side].set(
          !drag && line && onGutter(e)
            ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'comment-plus' } }]
            : [],
        );
      }),
      editor.onMouseLeave(() => hoverDeco[side].clear()),
    ];
  });

  const zoneListeners = sides.flatMap((side) => {
    const editor = ctx.editors[side];
    return [
      editor.onDidLayoutChange(() => zoneNodes[side].forEach((node) => fitWidth(side, node))),
      editor.onDidScrollChange(({ scrollLeft, scrollLeftChanged }) => {
        if (!scrollLeftChanged) return;
        for (const node of zoneNodes[side]) node.style.translate = `${scrollLeft}px`;
      }),
    ];
  });

  render();
  const unsubscribe = useFeedback.subscribe((s, prev) => {
    if (s.comments !== prev.comments) render();
  });


  return {
    openComposer(side, startLine, endLine) {
      if (!sides.includes(side)) return;
      setComposer({ side, startLine, endLine, body: '' });
      render();
    },
    dispose() {
      unsubscribe();
      gutterListeners.forEach((d) => d.dispose());
      window.removeEventListener('mouseup', finishDrag);
      window.removeEventListener('mousemove', onDragMove);
      for (const side of sides) {
        hoverDeco[side].clear();
        rangeDeco[side].clear();
        ctx.editors[side].getDomNode()?.classList.remove('gutter-dragging');
      }
      zoneListeners.forEach((d) => d.dispose());
      clearZones();
    },
  };
}
