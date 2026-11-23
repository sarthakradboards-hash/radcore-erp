// RAD-134 (M3-28): every refusal a library can raise reaches the person as a named refusal, never as a 500. apps/api's
// failureOf answers an AppError whose code is neither a platform code nor in the route's `errors` as server_error,
// which no service test sees (#286's booking_live and unit_held). This scans packages/lib-*/src, tests out, for every
// AppError code: a literal given to `new AppError`, or to a local helper that passes its parameter on as the code
// (`refuse(code, message)`). Each must be a platform code or in some mounted contract's `errors`. A computed code is
// allowed only when it re-throws an AppError's own (`e.code`). Which route reaches which code isn't mapped: codes
// travel through helpers and across libraries (the architect's ruling); apps/api's handler checks that at run time.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_ERRORS } from '@radcore/lib-common';
import { createClientErrors, loadConfig, type Route } from '@radcore/lib-platform';
import { createAuth } from '@radcore/lib-platform/runtime';
import { createEnquiryForm } from '@radcore/lib-crm';
import { testSettings } from '@radcore/test-helpers';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { apiRoutes } from '../apps/api/src/routes.ts';
import webhooks from '../apps/api/src/routes/hooks.ts';

type Found = { file: string; line: number; code: string | null; text: string };

/** Codes no mounted route can reach yet, each with why. The route that first reaches one declares it, and leaves here. */
// transfer_same_location left with RAD-141's POST /stock/transfers, which declares it.
const NOT_YET_REACHED: Readonly<Record<string, string>> = {};

/** Every AppError code a source file raises: `code` null for one computed from something other than `<x>.code`. */
export function codesIn(file: string, source: string): Found[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Found[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const isAppError = (n: ts.Node): n is ts.NewExpression => ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'AppError';
  // A function whose parameter becomes the code: its name and that parameter's index.
  const helpers = new Map<string, number>();
  const paramsOf = (n: ts.Node): ts.NodeArray<ts.ParameterDeclaration> | null =>
    ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) ? n.parameters : null;
  const nameOf = (fn: ts.Node): string | null => {
    if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null;
    return ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null;
  };
  const enclosingParam = (id: ts.Identifier): { fn: ts.Node; index: number } | null => {
    for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
      const params = paramsOf(p);
      const index = params?.findIndex((q) => ts.isIdentifier(q.name) && q.name.text === id.text) ?? -1;
      if (index >= 0) return { fn: p, index };
    }
    return null;
  };
  const findHelpers = (n: ts.Node): void => {
    const first = isAppError(n) ? n.arguments?.[0] : undefined;
    if (first !== undefined && ts.isIdentifier(first)) {
      const param = enclosingParam(first);
      const name = param === null ? null : nameOf(param.fn);
      if (param !== null && name !== null) helpers.set(name, param.index);
    }
    ts.forEachChild(n, findHelpers);
  };
  findHelpers(sf);
  // A helper is learnt in its own file only, so one exported would hide its other files' codes (the auditor on #300).
  const exported = new Set<string>();
  const markExports = (n: ts.Node): void => {
    const isExported = (d: ts.Node) => ts.canHaveModifiers(d) && (ts.getModifiers(d) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(n) && n.name !== undefined && isExported(n)) exported.add(n.name.text);
    if (ts.isVariableStatement(n) && isExported(n)) {
      for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) exported.add(d.name.text);
    }
    if (ts.isExportSpecifier(n)) exported.add((n.propertyName ?? n.name).text);
    ts.forEachChild(n, markExports);
  };
  markExports(sf);
  // A code as written: a literal, a re-thrown `<x>.code` (allowed, nothing to check), or computed (null).
  const codeOf = (a: ts.Expression): string | null | 'rethrown' => {
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
    // `e.code` passes whatever e is, a pg error's SQLSTATE too: as an AppError's code that's undeclared, so the
    // handler's run-time check is what catches it.
    if (ts.isPropertyAccessExpression(a) && a.name.text === 'code') return 'rethrown';
    return null;
  };
  const visit = (n: ts.Node): void => {
    let arg: ts.Expression | undefined;
    if (isAppError(n)) {
      arg = n.arguments?.[0];
      // A helper's own `new AppError(code, …)`: its callers' literals are what's checked.
      if (arg !== undefined && ts.isIdentifier(arg) && enclosingParam(arg) !== null && helpers.has(nameOf(enclosingParam(arg)?.fn ?? n) ?? '')) arg = undefined;
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && helpers.has(n.expression.text)) {
      arg = n.arguments[helpers.get(n.expression.text) ?? 0];
    }
    if (arg !== undefined) {
      const code = codeOf(arg);
      if (code !== 'rethrown') found.push({ file, line: at(n), code, text: arg.getText(sf) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const name of helpers.keys()) {
    if (exported.has(name)) found.push({ file, line: 1, code: null, text: `${name}, a code-passing helper, exported` });
  }
  return found;
}

const sources = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const path = join(dir, f);
  if (statSync(path).isDirectory()) return sources(path);
  return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [path] : [];
});

describe('AppError codes', () => {
  it('finds literals, literals given to a local refuse() helper, re-thrown codes, and computed ones', () => {
    const sample = `
      const refuse = (code: string, message: string): never => { throw new AppError(code, message); };
      function hold() { refuse('booking_live', 'Booked'); throw new AppError('unit_held', 'Held'); }
      function again(e: AppError) { throw new AppError(e.code, e.message); }
      function odd(kind: string) { throw new AppError(\`\${kind}_gone\`, 'Gone'); }
      export function refuseOut(code: string): never { throw new AppError(code, 'x'); }`;
    expect(codesIn('sample.ts', sample).map((f) => [f.code, f.line, f.code === null ? f.text : ''])).toEqual([['booking_live', 3, ''],
      ['unit_held', 3, ''], [null, 5, '`${kind}_gone`'], [null, 1, 'refuseOut, a code-passing helper, exported']]);
  });

  it('are each a platform code or declared by some mounted contract (#286\'s booking_live and unit_held)', async () => {
    const log = { info: () => undefined, error: () => undefined };
    const auth = await createAuth(loadConfig(testSettings(), 'api'), log);
    let routes: readonly Route[];
    try {
      routes = apiRoutes(auth, createClientErrors(log), createEnquiryForm({ outbound: { request: () => Promise.reject(new Error('no network in this test')) }, secret: 'unused' }));
    } finally {
      await auth.store.stop();
    }
    const declared = new Set([...Object.keys(PLATFORM_ERRORS), 'server_error',
      ...[...routes, ...webhooks].flatMap((r) => [...(r.contract.errors ?? [])])]);
    const libs = readdirSync('packages').filter((p) => p.startsWith('lib-')).map((p) => join('packages', p, 'src'));
    const found = libs.flatMap(sources).flatMap((f) => codesIn(f.replaceAll('\\', '/'), readFileSync(f, 'utf8')));
    expect(found.length).toBeGreaterThan(100);
    // A code waiting for its route is no longer waiting once a contract declares it.
    expect(Object.keys(NOT_YET_REACHED).filter((c) => declared.has(c))).toEqual([]);
    expect(found.filter((f) => f.code === null || !(declared.has(f.code) || f.code in NOT_YET_REACHED))
      .map((f) => `${f.file}:${f.line} ${f.code === null ? `computed code ${f.text}` : `${f.code} is in no contract's errors`}`)).toEqual([]);
  }, 60_000);
});
