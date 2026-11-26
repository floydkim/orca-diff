export interface Token { cls: string; text: string }

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

// monaco.editor.colorize 결과 HTML을 줄별 토큰으로 바꾼다.
// 줄은 <br/>로 끝나고 토큰은 <span class="mtkN">이다(RTL 글자는 class 앞에 style이 붙기도 한다).
export function parseColorized(html: string): Token[][] {
  // 공백과 탭은 nbsp 문자로 나오므로 일반 공백으로 되돌린다
  const decode = (s: string) =>
    s
      .replace(/&(#\d+|[a-z]+);/g, (m, e: string) => (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : (ENTITIES[e] ?? m)))
      .replace(/ /g, ' ');
  const lines = html.split('<br/>');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => [...line.matchAll(/<span [^>]*?class="([^"]+)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({ cls: m[1], text: decode(m[2]) })));
}
