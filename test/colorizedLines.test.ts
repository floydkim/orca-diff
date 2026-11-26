import { expect, test } from 'vitest';
import { parseColorized } from '../web/src/nav/colorizedLines.ts';

test('colorize HTML을 줄별 토큰으로 나누고 엔티티와 nbsp를 되돌린다', () => {
  const html =
    '<span><span class="mtk6">const</span><span class="mtk1"> a =&#160;</span><span class="mtk5 mtki">&lt;b&gt;&amp;</span></span><br/>' +
    '<span><span></span></span><br/>' +
    '<span><span style="unicode-bidi:isolate" class="mtk1">x</span></span><br/>';
  expect(parseColorized(html)).toEqual([
    [{ cls: 'mtk6', text: 'const' }, { cls: 'mtk1', text: ' a = ' }, { cls: 'mtk5 mtki', text: '<b>&' }],
    [],
    [{ cls: 'mtk1', text: 'x' }],
  ]);
});
