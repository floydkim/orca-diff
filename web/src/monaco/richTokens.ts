import type * as monaco from 'monaco-editor';

type Language = monaco.languages.IMonarchLanguage;
type Rule = monaco.languages.IMonarchLanguageRule;

export const IDENT = /[a-zA-Z_$][\w$]*/.source;
// 이름 뒤에 (선택적으로 제네릭 하나를 거쳐) 여는 괄호가 오면 함수 호출로 본다
export const CALL_AHEAD = /(?=\s*(?:<[^<>()]*>)?\s*\()/.source;
export const CONSTANT = /[A-Z][A-Z0-9_]+\b(?![\w$])/.source;

// Monaco 기본 TS/JS 토크나이저(Monarch)는 함수 호출·속성·상수·연산자를 구분하지 않는다.
// GitHub처럼 보이도록 기본 규칙 앞에 몇 가지를 덧붙인다.
// shortcut: 정규식 추측이라 여러 줄에 걸친 제네릭 호출 등은 놓친다. 더 정확해야 하면 TextMate 문법(Shiki)으로 바꾼다
export function enrich(language: Language): Language {
  const extra: Rule[] = [
    [/\.\.\./, 'delimiter'],
    [new RegExp(`(\\.)(${IDENT})${CALL_AHEAD}`), ['delimiter', 'entity.name.function']],
    [new RegExp(`(\\.)(${IDENT})`), ['delimiter', 'property']],
    [new RegExp(`${IDENT}${CALL_AHEAD}`), { cases: { '@keywords': 'keyword', '@default': 'entity.name.function' } }],
    [new RegExp(CONSTANT), 'constant'],
    // 제네릭의 <, >는 기본 규칙대로 괄호로 두고, 나머지 연산자만 따로 칠한다
    [/[<>](?!@symbols)/, '@brackets'],
    [/!(?=([^=]|$))/, 'keyword.operator'],
    [/@symbols/, { cases: { '@operators': 'keyword.operator', '@default': '' } }],
  ];
  const common = language.tokenizer.common as Rule[];
  return { ...language, tokenizer: { ...language.tokenizer, common: [...extra, ...common] } };
}
