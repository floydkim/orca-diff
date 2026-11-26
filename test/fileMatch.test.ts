import { describe, expect, test } from 'vitest';
import { matchIndices } from '../web/src/layout/fileMatch.ts';

describe('matchIndices', () => {
  test('파일 이름에 연속으로 있으면 경로 앞부분보다 이름 쪽을 강조한다', () => {
    expect(matchIndices('web/src/web.ts', 'web')).toEqual([8, 9, 10]);
  });
  test('이름에 없고 경로에 연속으로 있으면 그 부분을 강조한다', () => {
    expect(matchIndices('web/src/App.tsx', 'src/a')).toEqual([4, 5, 6, 7, 8]);
  });
  test('퍼지 매칭은 맞은 글자를 하나씩 강조한다(대소문자 무시)', () => {
    expect(matchIndices('web/src/App.tsx', 'wsa')).toEqual([0, 4, 8]);
  });
  test('매칭이 없으면 빈 배열', () => {
    expect(matchIndices('a/b.ts', 'zz')).toEqual([]);
  });
});
