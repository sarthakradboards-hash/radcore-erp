// RAD-84 (M1-19, RC-153): which libraries each route's and job's own code reaches, worked out from the code and
// compared with the hand-written ROUTE_REACH (tools/permission-manifest.ts). The api's and worker's lists are read as
// the code writes them: each route or job file holds only define* calls in its default export (E1), so the i-th call
// is the i-th route it mounts, and its service, its `before` and the define helper resolve, through TypeScript, to the
// files that declare them. A route built at start (createAuth's) or a job built there (the email jobs) resolves to
// what builds it. dependency-cruiser then follows each of those files' imports, through every file, to the libraries.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { loadConfig, type JobDefinition, type Route } from '@radcore/lib-platform';
import { createAuth } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import { cruise } from 'dependency-cruiser';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { apiRoutes } from '../apps/api/src/routes.ts';
import { workerJobs } from '../apps/worker/src/worker-jobs.ts';
import { ROUTE_REACH } from './permission-manifest.ts';

const LISTS = { api: 'apps/api/src/routes.ts', worker: 'apps/worker/src/worker-jobs.ts' };
const ROOT = resolve('.');
const repoPath = (f: string) => relative(ROOT, f).replaceAll('\\', '/');
const compilerOptions = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.base.json', ts.sys.readFile).config,
  ts.sys, ROOT).options;
const program = ts.createProgram(Object.values(LISTS), compilerOptions);
const checker = program.getTypeChecker();

/** The file that declares what `n` names: through an import or re-export, and for `a.b`, b's own declaration. */
function declaringFile(n: ts.Node): string | null {
  let s = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n) ? n.name : n);
  if (s !== undefined && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
  const d = s?.declarations?.[0];
  return d === undefined ? null : repoPath(d.getSourceFile().fileName);
}
/** Every file a call's callee and its arguments from `from` on are declared in: for a define call, its helper and
 * what follows the contract; for a builder called at start, the builder and everything handed to it. */
function filesOf(call: ts.CallExpression, from = 1): string[] {
  const out = [declaringFile(call.expression)];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) out.push(declaringFile(n));
    else if (ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n) || ts.isSpreadElement(n)) n.forEachChild(visit);
    else if (ts.isPropertyAssignment(n)) visit(n.initializer);
  };
  call.arguments.slice(from).forEach(visit);
  return out.filter((f): f is string => f !== null);
}
const defaultArray = (file: string): ts.ArrayLiteralExpression => {
  const src = program.getSourceFile(file);
  const e = src?.statements.find(ts.isExportAssignment)?.expression;
  if (e === undefined || !ts.isArrayLiteralExpression(e)) throw new Error(`${file}: its default export isn't an array of define calls`);
  return e;
};
/** For one list (apiRoutes' or workerJobs' array), each entry's files, in order. A spread of a route or job file opens
 * to its calls; a call made at start (`passwordResetEmailJob(start)`) is its builder's files; a spread of what start-up
 * built (`...auth.routes`) is the file declaring it, once for each entry of its runtime list, whose size `built` names
 * by the spread's own text. */
function entriesOf(list: string, built: Readonly<Record<string, number>>): string[][] {
  const fn = program.getSourceFile(list)?.statements.find(ts.isVariableStatement)?.declarationList.declarations[0]?.initializer;
  let body: ts.Node | undefined = fn !== undefined && ts.isArrowFunction(fn) ? fn.body : undefined;
  while (body !== undefined && ts.isParenthesizedExpression(body)) body = body.expression;
  if (body === undefined || !ts.isArrayLiteralExpression(body)) throw new Error(`${list}: not an arrow answering an array`);
  const out: string[][] = [];
  for (const el of body.elements) {
    const target = ts.isSpreadElement(el) ? el.expression : el;
    const file = declaringFile(target);
    if (ts.isSpreadElement(el) && file !== null && file.startsWith('apps/')) {
      for (const call of defaultArray(file).elements) {
        if (!ts.isCallExpression(call)) throw new Error(`${file}: an entry isn't a define call`);
        out.push(filesOf(call));
      }
    } else if (ts.isCallExpression(target)) {
      out.push(filesOf(target, 0));
    } else {
      const size = built[target.getText()];
      if (size === undefined) throw new Error(`${list}: no runtime size given for ${target.getText()}`);
      for (let n = 0; n < size; n += 1) out.push([file ?? list]);
    }
  }
  return out;
}

// One cruise from every file named; each entry's reach is what its files lead to.
async function reachOf(entries: string[][]): Promise<string[][]> {
  const config = createRequire(import.meta.url)('../.dependency-cruiser.cjs');
  const roots = [...new Set(entries.flat())];
  const { output } = await cruise(roots, { ...config.options, ruleSet: {} });
  if (typeof output === 'string') throw new Error('expected a cruise result');
  const deps = new Map(output.modules.map((m) => [m.source, m.dependencies.map((d) => d.resolved)]));
  return entries.map((files) => {
    const seen = new Set<string>();
    const todo = [...files];
    while (todo.length > 0) {
      const f = todo.pop() ?? '';
      if (seen.has(f)) continue;
      seen.add(f);
      todo.push(...(deps.get(f) ?? []));
    }
    // lib-common holds no services; every other library reached is.
    return [...new Set([...seen].flatMap((f) => /^packages\/(lib-[a-z]+)\//.exec(f)?.[1] ?? []))]
      .filter((l) => l !== 'lib-common').toSorted();
  });
}

/** Every disagreement between the derived reach and the table. */
function disagreements(found: Readonly<Record<string, readonly string[]>>, table: Readonly<Record<string, readonly string[]>>): string[] {
  const same = (a: readonly string[], b: readonly string[]) => a.join() === [...b].toSorted().join();
  return [
    ...Object.keys(found).filter((k) => !(k in table)).map((k) => `${k}: mounted, but not in ROUTE_REACH`),
    ...Object.keys(table).filter((k) => !(k in found)).map((k) => `${k}: in ROUTE_REACH, but nothing mounts it`),
    ...Object.keys(found).filter((k) => k in table && !same(found[k] ?? [], table[k] ?? []))
      .map((k) => `${k}: reaches ${found[k]?.join(', ') ?? ''}, but ROUTE_REACH says ${table[k]?.join(', ') ?? ''}`),
  ];
}

describe('the manifest’s reach', () => {
  const cfg = loadConfig(testSettings(), 'api');
  async function derived(): Promise<Record<string, readonly string[]>> {
    const auth = await createAuth(cfg, { info: () => undefined, error: () => undefined });
    let routes: readonly Route[];
    try {
      routes = apiRoutes(auth);
    } finally {
      await auth.store.stop();
    }
    const jobs: readonly JobDefinition[] = workerJobs({ mailer: { send: async () => undefined }, publicOrigin: cfg.publicOrigin });
    const routeFiles = entriesOf(LISTS.api, { 'auth.routes': auth.routes.length });
    const jobFiles = entriesOf(LISTS.worker, {});
    expect([routeFiles.length, jobFiles.length]).toEqual([routes.length, jobs.length]);
    const keys = [...routes.map((r) => `${r.contract.method} ${r.contract.path}`), ...jobs.map((j) => j.name)];
    const reach = await reachOf([...routeFiles, ...jobFiles]);
    return Object.fromEntries(keys.map((k, i) => [k, reach[i] ?? []]));
  }

  it('matches what each route and job reaches, line for line', async () => {
    expect(disagreements(await derived(), ROUTE_REACH)).toEqual([]);
  }, 120_000);

  it('reads each route file as the api mounts it, and finds the service’s own file', () => {
    // files.ts's first route is the photo upload, served by lib-platform's files engine.
    const [first] = entriesOf(LISTS.api, { 'auth.routes': 0 });
    // A list built at start is sized from the runtime by name, wherever it sits; one with no size is refused.
    expect(() => entriesOf(LISTS.api, {})).toThrow('no runtime size given for auth.routes');
    expect(first?.some((f) => f.startsWith('packages/lib-platform/src/files/'))).toBe(true);
    expect(readdirSync(join('apps', 'api', 'src', 'routes')).every((f) => f.endsWith('.ts'))).toBe(true);
  });

  it('counts a module library a file reaches, and never lib-common', async () => {
    expect(await reachOf([['packages/lib-sales/src/index.ts'], ['packages/lib-common/src/index.ts'], ['packages/lib-platform/src/route.ts']]))
      .toEqual([['lib-sales'], [], ['lib-platform']]);
  }, 120_000);

  // RC-153: the sweep must notice a reach that's new or gone. Each case tampers with a copy of what was found.
  it.each([
    ['a route reaching another module', (m: Record<string, readonly string[]>) => ({ ...m, 'GET /me': ['lib-crm', 'lib-platform'] })],
    ['a reach that stopped', (m: Record<string, readonly string[]>) => ({ ...m, 'platform.export': [] })],
    ['a new route with no line', (m: Record<string, readonly string[]>) => ({ ...m, 'POST /sales/invoices': ['lib-sales'] })],
  ])('fails on %s', async (_, tamper) => {
    expect(disagreements(tamper(await derived()), ROUTE_REACH)).toHaveLength(1);
  }, 120_000);
});
