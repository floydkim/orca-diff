import { expect, test } from 'vitest';
import { CALL_AHEAD, CONSTANT, IDENT } from '../web/src/monaco/richTokens.ts';

const call = new RegExp(`^${IDENT}${CALL_AHEAD}`);
const constant = new RegExp(`^${CONSTANT}`);

test('함수 호출: 이름 뒤에 괄호, 또는 제네릭 하나를 거친 괄호', () => {
  expect(call.test('useFeedback();')).toBe(true);
  expect(call.test('useState<string | null>(null)')).toBe(true);
  expect(call.test('useState<Terminal[]>([])')).toBe(true);
  expect(call.test('comments;')).toBe(false);
  expect(call.test('a < b')).toBe(false);
});

test('상수: 두 글자 이상의 대문자 이름만', () => {
  expect(constant.exec('HOST || WT')?.[0]).toBe('HOST');
  expect(constant.exec('SAVE_DELAY_MS)')?.[0]).toBe('SAVE_DELAY_MS');
  expect(constant.test('Terminal')).toBe(false);
  expect(constant.test('A')).toBe(false);
});
