// Monaco 기본 언어 정의 모듈(타입 선언이 없음)
declare module 'monaco-editor/languages/definitions/*.js' {
  import type * as monaco from 'monaco-editor';
  export const language: monaco.languages.IMonarchLanguage;
}
