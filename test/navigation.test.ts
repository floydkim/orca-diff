import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { definition, references, warm } from '../server/ts/navigation.ts';
import { TsServer } from '../server/ts/tsserver.ts';
import { gitFixture, type GitFixture } from './helpers/gitFixture.ts';

let fx: GitFixture;
const MAIN = "import { sum } from './util';\n\nexport const total = sum(1, 2);\n";

beforeAll(async () => {
  // node_modules 없이 tsconfig + 파일 2개
  fx = await gitFixture();
  await fx.commit(
    {
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler' } }),
      'util.ts': 'export function sum(a: number, b: number) {\n  return a + b;\n}\n',
      'main.ts': MAIN,
    },
    'init',
  );
});
afterAll(() => TsServer.forWorktree(fx.dir).dispose());

describe('navigation', () => {
  test('미리 읽어 두기는 TS 파일만 받고, 연 파일을 닫아 이후 질의에 영향을 주지 않는다', async () => {
    await expect(warm(fx.dir, 'tsconfig.json')).rejects.toThrow('TS/JS 파일만');
    await warm(fx.dir, 'main.ts');
    expect(await definition(fx.dir, { path: 'main.ts', line: 3, column: 22 })).toHaveLength(1);
  });

  test('호출 위치에서 선언으로 이동한다', async () => {
    const locs = await definition(fx.dir, { path: 'main.ts', line: 3, column: 22 });
    expect(locs).toEqual([{ path: 'util.ts', line: 1, column: 17, preview: 'export function sum(a: number, b: number) {' }]);
  });

  test('선언 위치에서 사용처를 찾는다(선언 제외)', async () => {
    const locs = await references(fx.dir, { path: 'util.ts', line: 1, column: 17 });
    expect(locs.filter(l => l.isImport).map(l => l.line)).toEqual([1]);
    expect(locs.map((l) => `${l.path}:${l.line}`).sort()).toEqual(['main.ts:1', 'main.ts:3']);
  });

  test('content 오버라이드 기준으로 위치를 해석한다', async () => {
    const locs = await definition(fx.dir, { path: 'main.ts', line: 6, column: 22, content: '\n\n\n' + MAIN });
    expect(locs[0]).toMatchObject({ path: 'util.ts', line: 1 });
    // 오버라이드 후에도 디스크 기준 질의가 다시 맞아야 한다
    expect((await definition(fx.dir, { path: 'main.ts', line: 3, column: 22 }))[0]).toMatchObject({ path: 'util.ts' });
  });

  test('content 오버라이드는 다른 파일 질의에 남지 않는다', async () => {
    await definition(fx.dir, { path: 'main.ts', line: 6, column: 22, content: '\n\n\n' + MAIN });
    const refs = await references(fx.dir, { path: 'util.ts', line: 1, column: 17 });
    expect(refs.map((l) => `${l.path}:${l.line}`).sort()).toEqual(['main.ts:1', 'main.ts:3']);
  });

  test('dispose된 서버에 요청하면 프로세스를 죽이지 않고 reject한다', async () => {
    const server = TsServer.forWorktree(fx.dir);
    server.dispose();
    await expect(server.request('configure', {})).rejects.toThrow();
  });

  test('TS/JS가 아닌 파일은 거부한다', async () => {
    await expect(definition(fx.dir, { path: 'Main.kt', line: 1, column: 1 })).rejects.toThrow();
  });
});
