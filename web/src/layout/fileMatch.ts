// Search Everywhere의 파일 이름 매칭. score와 matchIndices는 같은 규칙을 따라야 한다.
export function score(path: string, query: string) {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (lower.includes(query)) return 3;
  let pos = -1;
  for (const char of query) {
    pos = lower.indexOf(char, pos + 1);
    if (pos < 0) return Infinity;
  }
  return 4;
}

// 강조할 글자 위치(path 기준). query는 소문자로 받는다.
export function matchIndices(path: string, query: string): number[] {
  if (!query) return [];
  const lower = path.toLowerCase();
  const nameStart = lower.lastIndexOf('/') + 1;
  const range = (start: number) => Array.from({ length: query.length }, (_, i) => start + i);
  const inName = lower.indexOf(query, nameStart);
  if (inName >= 0) return range(inName);
  const inPath = lower.indexOf(query);
  if (inPath >= 0) return range(inPath);
  const out: number[] = [];
  let pos = -1;
  for (const char of query) {
    pos = lower.indexOf(char, pos + 1);
    if (pos < 0) return [];
    out.push(pos);
  }
  return out;
}
