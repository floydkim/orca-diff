import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { assertInside, BadRequest, listChanges, readFilePair, readPatch } from '../git/changes.ts';
import { listBranches, listCommits, listWorktrees, resolveBaseRef } from '../git/history.ts';
import { git, GitError } from '../git/run.ts';
import { searchCode } from '../search.ts';
import { definition, type NavQuery, references } from '../ts/navigation.ts';
import type { Change, ChangeStatus, Source } from '../shared/types.ts';

export interface RequestContext {
  wt: string;
  // 탭을 연 Orca 워크트리입니다. 피드백을 보낼 터미널을 여기서 찾습니다. 따로 주지 않으면 wt와 같습니다.
  // 준 경로가 워크트리가 아니게 되면(삭제 등) null이고, 터미널 기능만 쓸 수 없습니다.
  host: string | null;
  query: URLSearchParams;
  body: unknown;
}

type Handler = (ctx: RequestContext) => Promise<unknown>;
export type Routes = Record<string, Handler>; // 키: "GET /api/xxx"

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const MAX_BODY = 8 * 1024 * 1024;

export function parseSource(raw: string | null): Source {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? '');
  } catch {
    throw new BadRequest('source가 JSON이 아닙니다');
  }
  const s = v as Record<string, unknown> | null;
  if (s?.kind === 'unstaged' || s?.kind === 'staged') return { kind: s.kind };
  if (s?.kind === 'commits' && typeof s.from === 'string' && typeof s.to === 'string' && isRev(s.from) && isRev(s.to)) {
    return { kind: 'commits', from: s.from, to: s.to };
  }
  throw new BadRequest('잘못된 source입니다');
}

// 옵션 주입(-로 시작)을 막기 위해 리비전 문자열을 제한한다
function isRev(s: string): boolean {
  return s.length > 0 && !s.startsWith('-') && !/[\s\0]/.test(s);
}

function requireRev(s: string | null, name: string): string {
  if (!s || !isRev(s)) throw new BadRequest(`잘못된 ${name}입니다`);
  return s;
}

function parseChange(q: URLSearchParams, wt: string): Change {
  const path = q.get('path') ?? '';
  const status = q.get('status') as ChangeStatus;
  if (!['A', 'M', 'D', 'R'].includes(status)) throw new BadRequest('잘못된 status입니다');
  assertInside(wt, path);
  const oldPath = q.get('oldPath') ?? undefined;
  if (oldPath !== undefined) assertInside(wt, oldPath);
  return { path, oldPath, status, binary: q.get('binary') === '1' };
}

function parseNavQuery(body: unknown): NavQuery {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.path !== 'string' || typeof b.line !== 'number' || typeof b.column !== 'number') {
    throw new BadRequest('path, line, column이 필요합니다');
  }
  if (b.content !== undefined && typeof b.content !== 'string') throw new BadRequest('content는 문자열이어야 합니다');
  return { path: b.path, line: b.line, column: b.column, content: b.content as string | undefined };
}

const coreRoutes: Routes = {
  'GET /api/worktree-files': async ({ wt }) => {
    const [files, deleted] = await Promise.all([
      git(wt, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
      git(wt, ['ls-files', '--deleted', '-z']),
    ]);
    const paths = new Set(files.split('\0'));
    for (const path of deleted.split('\0')) paths.delete(path);
    return [...paths];
  },
  'GET /api/worktrees': ({ wt }) => listWorktrees(wt),
  'GET /api/branches': async ({ wt }) => ({ ...(await listBranches(wt)), base: await resolveBaseRef(wt) }),
  'GET /api/commits': ({ wt, query }) => {
    const limit = Math.min(Number(query.get('limit') ?? 200) || 200, 1000);
    const skip = Math.max(Number(query.get('skip') ?? 0) || 0, 0);
    const base = query.get('base');
    return listCommits(wt, {
      ref: requireRev(query.get('ref') ?? 'HEAD', 'ref'),
      base: base ? requireRev(base, 'base') : null,
      skip,
      limit,
    });
  },
  'GET /api/changes': ({ wt, query }) => listChanges(wt, parseSource(query.get('source'))),
  'GET /api/file-pair': ({ wt, query }) => readFilePair(wt, parseSource(query.get('source')), parseChange(query, wt)),
  'GET /api/patch': ({ wt, query }) => readPatch(wt, parseSource(query.get('source')), parseChange(query, wt)),
  'POST /api/definition': ({ wt, body }) => definition(wt, parseNavQuery(body)),
  'POST /api/references': ({ wt, body }) => references(wt, parseNavQuery(body)),
  'GET /api/search': ({ wt, query }) => {
    const q = query.get('q') ?? '';
    if (!q.trim()) throw new BadRequest('검색어가 필요합니다');
    return searchCode(wt, {
      query: q,
      caseSensitive: query.get('case') === '1',
      regex: query.get('regex') === '1',
      wholeWord: query.get('word') === '1',
    });
  },
  'GET /api/file': async ({ wt, query }) => ({ content: await readFile(assertInside(wt, query.get('path') ?? ''), 'utf8') }),
  // shortcut: macOS Finder(`open -R`)만 지원한다. 다른 OS에서 쓰게 되면 그 OS의 파일 관리자 명령을 추가한다.
  'POST /api/reveal': async ({ wt, body }) => {
    const { path } = (body ?? {}) as { path?: unknown };
    if (typeof path !== 'string' || !path) throw new BadRequest('path가 필요합니다');
    const abs = assertInside(wt, path);
    await stat(abs).catch(() => {
      throw new BadRequest(`워크트리에 없는 파일입니다: ${path}`);
    });
    await promisify(execFile)('open', ['-R', abs]);
    return { ok: true };
  },
};

function keyMatches(expected: Buffer, given: string | null): boolean {
  if (!given) return false;
  const buf = Buffer.from(given);
  return buf.length === expected.length && timingSafeEqual(buf, expected);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== 'POST') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new BadRequest('요청 본문이 너무 큽니다');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new BadRequest('본문이 JSON이 아닙니다');
  }
}

export function createApp(opts: { key: string; staticDir: string | null; routes?: Routes }): Server {
  const expectedKey = Buffer.from(opts.key);
  const routes: Routes = { ...coreRoutes, ...opts.routes };
  // wt 검증 결과 메모(경로 → 정규화된 최상위 경로)
  const wtCache = new Map<string, Promise<string | null>>();

  const resolveWt = (wt: string | null): Promise<string | null> => {
    if (!wt) return Promise.resolve(null);
    let p = wtCache.get(wt);
    if (!p) {
      p = (async () => {
        try {
          const [real, top] = await Promise.all([realpath(wt), git(wt, ['rev-parse', '--show-toplevel'])]);
          return real === (await realpath(top.trim())) ? real : null;
        } catch {
          return null;
        }
      })();
      wtCache.set(wt, p);
    }
    return p;
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (!url.pathname.startsWith('/api/')) {
        await serveStatic(opts.staticDir, url.pathname, res);
        return;
      }
      if (!keyMatches(expectedKey, url.searchParams.get('key'))) return send(res, 401, { error: '인증 실패' });
      if (url.pathname === '/api/health') return send(res, 200, { ok: true });

      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: '없는 경로입니다' });

      const body = await readBody(req);
      const rawWt = url.searchParams.get('wt') ?? (body as { wt?: string } | null)?.wt ?? null;
      const wt = await resolveWt(rawWt);
      if (!wt) return send(res, 400, { error: '유효한 워크트리가 아닙니다' });
      const rawHost = url.searchParams.get('host');
      const host = rawHost ? await resolveWt(rawHost) : wt;

      send(res, 200, await handler({ wt, host, query: url.searchParams, body }));
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      if (e instanceof GitError) return send(res, 500, { error: e.message });
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return send(res, 404, { error: '파일이 없습니다' });
      send(res, 500, { error: (e as Error).message });
    }
  });
}

async function serveStatic(staticDir: string | null, pathname: string, res: ServerResponse) {
  if (!staticDir) {
    res.writeHead(404).end();
    return;
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  let file = assertInside(staticDir, rel);
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch {
    // SPA: 알 수 없는 경로는 index.html
    file = join(staticDir, 'index.html');
    content = await readFile(file);
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(content);
}
