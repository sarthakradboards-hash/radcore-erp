// ESLint for ADR-001 (E1 to E5) and ADR-002 (L1 to L6, L8, L9). Every ADR rule is its own rule in the local
// `radcore` plugin (tools/eslint-plugin-radcore.mjs), with its selectors and patterns as options here.
// tools/eslint-config.test.ts pins the options and zones; tools/boundaries.test.ts runs the violating fixtures.
// Import-graph rules (D1 to D9, L7) are in .dependency-cruiser.cjs.
import drizzle from 'eslint-plugin-drizzle';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';
import radcore from './tools/eslint-plugin-radcore.mjs';

const ALL = ['apps/**/*.{ts,tsx,js,mjs}', 'packages/**/*.{ts,tsx,js,mjs}'];
const SERVER = ['packages/**/*.{ts,tsx,js,mjs}', 'apps/api/**/*.{ts,tsx,js,mjs}', 'apps/worker/**/*.{ts,tsx,js,mjs}'];
const VIEW_FILES = 'packages/db/views/!(index).ts';
const REQUEST_CONTEXT = 'packages/db/src/request-context.ts';
const TABLE_FILES = ['packages/db/src/*/tables.ts', 'packages/db/src/columns.ts'];
const DB_CLIENT = 'packages/lib-platform/src/db/client.ts';
const OUTBOUND_CLIENT = 'packages/lib-platform/src/http/outbound.ts';

/** ADR-002 "Each rule's zone": the exact files where each rule is off. Pinned by tools/eslint-config.test.ts. */
export const ZONES = {
  'radcore/no-query-strings': [VIEW_FILES, REQUEST_CONTEXT],
  'radcore/no-raw-execution': [REQUEST_CONTEXT],
  'radcore/no-driver': [DB_CLIENT, 'packages/db/src/migrate.ts'],
  'radcore/tables-in-schema': TABLE_FILES,
  'radcore/views-in-views': [VIEW_FILES],
  'radcore/outbound-only': [OUTBOUND_CLIENT],
};
/** L1's SQL zone: `sql` allowed in its positions, and the drizzle-orm allowlist off. L1 itself is never off. */
export const L1_SQL_ZONE = [VIEW_FILES, ...TABLE_FILES, REQUEST_CONTEXT];
const L1_ALLOW = ['and', 'or', 'not', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull', 'inArray', 'between',
  'like', 'ilike', 'asc', 'desc', 'count', 'countDistinct', 'sum', 'avg', 'min', 'max', 'exists'];
/** L1's per-file allowlist additions (ADR-002), with the rest of L1 still on. */
export const L1_EXTRA_NAMES = {
  'packages/db/src/*/relations.ts': ['relations'],
  'packages/db/src/conditions.ts': ['notInArray'],
  'packages/db/src/module-tx.ts': ['getOperators', 'getOrderByOperators', 'is', 'getTableName'],
};

const msg = (tag, adr, text) => `[${tag}] ${text} (${adr}).`;
const sel = (tag, adr, text) => (selector) => ({ selector, message: msg(tag, adr, text) });
const SQL_SHAPE = String.raw`/\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\s+from\b|\bwith\b[\s\S]*\bas\s*\(|\b(create|alter|drop)\s+(or\s+replace\s+)?(table|view|index|trigger|function)\b|\btruncate\s+(table\b|\w+\s*;?$)|\bgrant\b[\s\S]*\b(on|to)\b/i`;
const DEFINE = '/^define(Route|Webhook|Job|Export|Import|Approval)$/';

/** Each rule's options, as the config test expects them. */
export const OPTIONS = {
  'radcore/no-sql': { allowNames: L1_ALLOW },
  'radcore/no-query-strings': {
    // shortcut: a template is checked one piece at a time, so a statement split across `${}` before its second
    // keyword escapes; L1 still catches the `sql` tag and the module transaction offers no raw route (ADR-002 §4).
    syntax: [`Literal[value=${SQL_SHAPE}]`, `TemplateElement[value.raw=${SQL_SHAPE}]`]
      .map(sel('L2', 'ADR-002', 'This string is shaped like SQL. Use Drizzle, or reword the message')),
  },
  'radcore/no-raw-execution': {
    syntax: ['CallExpression[arguments.length>0][callee.property.name=/^(execute|unsafe|query)$/]']
      .map(sel('L3', 'ADR-002', 'No raw execution of SQL text')),
  },
  'radcore/no-driver': {
    imports: [{ source: '^(pg|pg-[^/]+|postgres|@electric-sql/[^/]+|drizzle-orm/(node-postgres|pglite|postgres-js)[^/]*)(/.*)?$',
      message: msg('L4', 'ADR-002', `Only ${DB_CLIENT} and the migrator open connections`) }],
  },
  'radcore/no-raw-html': {
    syntax: [
      'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
      "CallExpression[callee.property.name='insertAdjacentHTML']",
      "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
      "CallExpression[callee.property.name='setHTMLUnsafe']",
      "JSXAttribute[name.name='srcDoc']",
    ].map(sel('L6', 'ADR-002', 'No raw HTML')),
  },
  'radcore/outbound-only': {
    globals: ['fetch', 'WebSocket', 'XMLHttpRequest'].map((name) =>
      ({ name, message: msg('L8', 'ADR-002', `Outside calls go through ${OUTBOUND_CLIENT}`) })),
    syntax: ["MemberExpression[object.name=/^(globalThis|global)$/][property.name='fetch']"]
      .map(sel('L8', 'ADR-002', `Outside calls go through ${OUTBOUND_CLIENT}`)),
    imports: [
      { source: '^(node:)?(undici|axios|got|node-fetch|ws|http|https|http2|net|tls|dgram|child_process)(/.*)?$',
        message: msg('L8', 'ADR-002', `Outside calls go through ${OUTBOUND_CLIENT}`) },
      { source: '^(node:)?module$', names: ['createRequire'], message: msg('L8', 'ADR-002', 'No createRequire') },
    ],
  },
  'radcore/tables-in-schema': {
    imports: [{ source: '^drizzle-orm/pg-core$', names: ['pgTable', 'pgSchema', 'pgEnum'],
      message: msg('L9a', 'ADR-002', 'Tables are declared only in packages/db/src/<module>/tables.ts') }],
  },
  'radcore/views-in-views': {
    imports: [{ source: '^drizzle-orm/pg-core$', names: ['pgView', 'pgMaterializedView'],
      message: msg('L9b', 'ADR-002', 'Views are declared only in packages/db/views/<name>.ts') }],
  },
  'radcore/e1-route-files': {
    syntax: [
      ...['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'IfStatement', 'SwitchStatement',
        'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement',
        'ConditionalExpression', 'LogicalExpression', 'UpdateExpression', "AssignmentExpression[operator!='=']",
        ...["'+'", "'-'", "'*'", "'/'", "'%'", "'**'"].map((op) => `BinaryExpression[operator=${op}]`),
        `CallExpression:not([callee.name=${DEFINE}])`, 'CallExpression > CallExpression.arguments']
        .map(sel('E1', 'ADR-001', 'Route and job files hold only define* calls; put the rule in the library')),
    ],
    onlyImports: { source: '^@radcore/lib-[a-z]+(-[a-z]+)*(/contract)?$',
      message: msg('E1', 'ADR-001', "Route and job files import only libraries' . and ./contract entries") },
  },
  'radcore/e3-no-io': {
    globals: ['process', 'fetch', 'setTimeout', 'setInterval', 'crypto'].map((name) =>
      ({ name, message: msg('E3', 'ADR-001', 'Pass time, randomness and I/O in as arguments or through ctx') })),
    syntax: [
      "MemberExpression[object.name='Math'][property.name='random']",
      "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      "NewExpression[callee.name='Date'][arguments.length=0]",
    ].map(sel('E3', 'ADR-001', 'No clock or randomness here; use ctx.clock or an argument')),
  },
  'radcore/e4-no-escape': {
    syntax: [
      "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
      "TSAsExpression[typeAnnotation.type='TSAnyKeyword']",
    ].map(sel('E4', 'ADR-001', 'No cast past the type checker')),
    globals: [{ name: 'Reflect', message: msg('E4', 'ADR-001', 'No reflection in libraries') }],
    imports: [{ source: '^drizzle-orm(/pg-core)?$', names: ['getTableConfig'],
      message: msg('E4', 'ADR-001', 'Libraries do not read table metadata') }],
  },
};
const on = (id, options = OPTIONS[id]) => ({ [id]: ['error', options] });

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts', 'coverage/**', 'tools/boundary-fixtures/**'] },
  // ADR-002: no comment can switch a rule off.
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' } },
  ...tseslint.configs.recommended,
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { plugins: { radcore, drizzle } },

  // E2 file size and E5 no switching the type checker off.
  { files: ALL, rules: {
    'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
    '@typescript-eslint/ban-ts-comment': ['error',
      { 'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true, 'ts-check': true }],
  } },

  // L1: on everywhere; its SQL zone, allowlist extras and test files get their own options below.
  { files: ALL, rules: on('radcore/no-sql') },
  { files: L1_SQL_ZONE, rules: on('radcore/no-sql', { ...OPTIONS['radcore/no-sql'], zone: true }) },
  { files: [REQUEST_CONTEXT], rules: on('radcore/no-sql', { ...OPTIONS['radcore/no-sql'], zone: true, helperBodies: true }) },
  ...Object.entries(L1_EXTRA_NAMES).map(([file, names]) =>
    ({ files: [file], rules: on('radcore/no-sql', { allowNames: [...L1_ALLOW, ...names] }) })),
  { files: ['**/*.test.{ts,tsx}'], rules: on('radcore/no-sql', { ...OPTIONS['radcore/no-sql'], importExpressions: false }) },

  // Server code: L2, L3, L5, L8, each off only in its zone.
  { files: SERVER, ignores: ZONES['radcore/no-query-strings'], rules: on('radcore/no-query-strings') },
  { files: SERVER, ignores: ZONES['radcore/no-raw-execution'], rules: on('radcore/no-raw-execution') },
  { files: SERVER, rules: {
    'drizzle/enforce-update-with-where': ['error', { drizzleObjectName: ['tx', 'db'] }],
    'drizzle/enforce-delete-with-where': ['error', { drizzleObjectName: ['tx', 'db'] }],
  } },
  { files: SERVER, ignores: ZONES['radcore/outbound-only'], rules: on('radcore/outbound-only') },

  // Everywhere: L4, L6, L9a, L9b.
  { files: ALL, ignores: ZONES['radcore/no-driver'], rules: on('radcore/no-driver') },
  { files: ALL, rules: on('radcore/no-raw-html') },
  { files: ALL, ignores: ZONES['radcore/tables-in-schema'], rules: on('radcore/tables-in-schema') },
  { files: ALL, ignores: ZONES['radcore/views-in-views'], rules: on('radcore/views-in-views') },

  // E1, E3.
  { files: ['apps/api/src/routes/**', 'apps/worker/src/jobs/**'], rules: on('radcore/e1-route-files') },
  { files: ['packages/lib-common/**', 'packages/*/src/contract.ts', 'packages/*/src/rules/**'], rules: on('radcore/e3-no-io') },

  // E4: with type information. These typed rules belong to E4 alone.
  { files: ['packages/lib-*/**/*.{ts,tsx}', 'packages/db/src/*/repo.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      ...on('radcore/e4-no-escape'),
    } },

  // The web app: Next's rules, with react/no-danger as an error and no exceptions (L6).
  ...nextVitals.map((c) => ({ ...c, files: ['apps/web/**/*.{ts,tsx,js,mjs}'] })),
  { files: ['apps/web/**/*.{ts,tsx,js,mjs}'], settings: { next: { rootDir: 'apps/web' } },
    rules: { 'react/no-danger': 'error' } },
);
