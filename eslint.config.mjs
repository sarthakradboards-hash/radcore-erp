// ESLint for ADR-001 (E1 to E5, D7's re-export guard) and ADR-002 (L1 to L6, L8, L9). Every ADR rule is its own rule
// in the local `radcore` plugin (tools/eslint-plugin-radcore.mjs), with its selectors and patterns as options here.
// tools/eslint-config.test.ts pins the options (tools/eslint-options.json) and zones; tools/boundaries.test.ts runs
// the violating fixtures. Import-graph rules (D1 to D9, L7) are in .dependency-cruiser.cjs.
import drizzle from 'eslint-plugin-drizzle';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';
import radcore from './tools/eslint-plugin-radcore.mjs';

// Every extension a source file could have. Only .ts and .tsx are allowed (tools/source-files.test.ts); the rest are
// listed so a stray file is still linted.
const EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const TS = '{ts,tsx,mts,cts}';
const ALL = [`apps/**/*.${EXT}`, `packages/**/*.${EXT}`];
const SERVER = [`packages/**/*.${EXT}`, `apps/api/**/*.${EXT}`, `apps/worker/**/*.${EXT}`];
const VIEW_FILES = 'packages/db/views/!(index|*.test|*.d).ts';
const REQUEST_CONTEXT = 'packages/db/src/request-context.ts';
const TABLE_FILES = ['packages/db/src/*/tables.ts', 'packages/db/src/columns.ts'];
const DB_CLIENT = 'packages/lib-platform/src/db/client.ts';
const OUTBOUND_CLIENT = 'packages/lib-platform/src/http/outbound.ts';
/** The one function in request-context.ts whose body may use `sql` (ADR-002 §3). */
export const REQUEST_CONTEXT_HELPER = 'applyRequestContext';

/** ADR-002 "Each rule's zone": the exact files where each rule is off. Pinned by tools/eslint-config.test.ts. */
export const ZONES = {
  'radcore/no-query-strings': [VIEW_FILES, REQUEST_CONTEXT],
  'radcore/no-raw-execution': [REQUEST_CONTEXT],
  'radcore/no-driver': [DB_CLIENT, 'packages/db/src/migrate.ts'],
  'radcore/tables-in-schema': TABLE_FILES,
  'radcore/views-in-views': [VIEW_FILES],
  'radcore/outbound-only': [OUTBOUND_CLIENT],
};
/** L1's SQL zone: `sql` allowed in its positions (plus `sql` on the allowlist). L1 itself is never off. */
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
// Statement shapes, with \W+ between keywords so a comment or other separator doesn't hide them.
const SQL_SHAPE = String.raw`/\bselect\b[\s\S]*\bfrom\b|\binsert\W+into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\W+from\b|\bwith\b[\s\S]*\bas\W*\(|\b(create|alter|drop)\W+(or\W+replace\W+)?(table|view|index|trigger|function)\b|\btruncate\W+(table\b|\w+\W*$)|\bgrant\b[\s\S]*\b(on|to)\b/i`;
const DEFINE = '/^define(Route|Webhook|Job|Export|Import|Approval)$/';
const GLOBAL_OBJECT = '/^(globalThis|global|window|self)$/';
const RAW_EXEC = '/^(execute|unsafe|query)$/';
const OUTBOUND_NAMES = '/^(getBuiltinModule|fetch|WebSocket|XMLHttpRequest)$/';
const L8 = msg('L8', 'ADR-002', `Outside calls and module loading go through ${OUTBOUND_CLIENT}`);
const E3 = 'Pass time, randomness and I/O in as arguments or through ctx';

/** Each rule's options. tools/eslint-options.json holds the same values as literals. */
export const OPTIONS = {
  'radcore/no-sql': { allowNames: L1_ALLOW },
  'radcore/no-query-strings': {
    // shortcut: a template is checked one piece at a time, so a statement split across `${}` before its second
    // keyword escapes; L1 still catches the `sql` tag and the module transaction offers no raw route (ADR-002 §4).
    syntax: [`Literal[value=${SQL_SHAPE}]`, `TemplateElement[value.raw=${SQL_SHAPE}]`, `TemplateElement[value.cooked=${SQL_SHAPE}]`]
      .map(sel('L2', 'ADR-002', 'This string is shaped like SQL. Use Drizzle, or reword the message')),
  },
  'radcore/no-raw-execution': {
    syntax: [
      `CallExpression[arguments.length>0][callee.property.name=${RAW_EXEC}]`,
      `CallExpression[arguments.length>0][callee.property.value=${RAW_EXEC}]`,
      `CallExpression[callee.property.name=/^(call|apply|bind)$/][callee.object.property.name=${RAW_EXEC}]`,
    ].map(sel('L3', 'ADR-002', 'No raw execution of SQL text')),
  },
  'radcore/no-driver': {
    imports: [{ source: '^(pg|pg-[^/]+|postgres|@electric-sql/[^/]+|drizzle-orm/(node-postgres|pglite|postgres-js)[^/]*)(/.*)?$',
      message: msg('L4', 'ADR-002', `Only ${DB_CLIENT} and the migrator open connections`) }],
  },
  'radcore/no-raw-html': {
    syntax: [
      'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
      'AssignmentExpression[left.property.value=/^(innerHTML|outerHTML)$/]',
      "CallExpression[callee.object.name='Object'][callee.property.name='assign'] Property[key.name=/^(innerHTML|outerHTML)$/]",
      "CallExpression[callee.property.name='insertAdjacentHTML']",
      "CallExpression[callee.property.name=/^(write|writeln)$/][callee.object.name='document']",
      "CallExpression[callee.property.name=/^(write|writeln)$/][callee.object.property.name='document']",
      "CallExpression[callee.property.name='setHTMLUnsafe']",
      "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^srcdoc$/i]",
      'JSXAttribute[name.name=/^srcdoc$/i]',
      "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      "Property[key.name='dangerouslySetInnerHTML']",
    ].map(sel('L6', 'ADR-002', 'No raw HTML')),
  },
  'radcore/outbound-only': {
    globals: ['fetch', 'WebSocket', 'XMLHttpRequest'].map((name) => ({ name, message: L8 })),
    syntax: [
      `MemberExpression[object.name=${GLOBAL_OBJECT}][property.name=/^(fetch|WebSocket|XMLHttpRequest)$/]`,
      `MemberExpression[object.name=${GLOBAL_OBJECT}][property.value=/^(fetch|WebSocket|XMLHttpRequest)$/]`,
      `MemberExpression[object.name=${GLOBAL_OBJECT}][property.quasis.0.value.cooked=/^(fetch|WebSocket|XMLHttpRequest)$/]`,
      `VariableDeclarator[init.name=${GLOBAL_OBJECT}]`,
      "MemberExpression[property.name='getBuiltinModule']",
      "MemberExpression[property.value='getBuiltinModule']",
      "MemberExpression[property.quasis.0.value.cooked='getBuiltinModule']",
      // Destructuring, by any spelling of the key: `const { getBuiltinModule: load } = process`.
      `ObjectPattern > Property[key.name=${OUTBOUND_NAMES}]`,
      `ObjectPattern > Property[key.value=${OUTBOUND_NAMES}]`,
      `ObjectPattern > Property[key.quasis.0.value.cooked=${OUTBOUND_NAMES}]`,
    ].map((selector) => ({ selector, message: L8 })),
    imports: [{ source: '^(node:)?(undici|axios|got|node-fetch|ws|http|https|http2|net|tls|dgram|child_process|module'
      + '|worker_threads|vm|inspector|cluster)(/.*)?$', message: L8 }],
  },
  'radcore/tables-in-schema': {
    imports: [{ source: '^drizzle-orm/pg-core(/.*)?$',
      names: ['pgTable', 'pgTableCreator', 'pgTableWithSchema', 'pgSchema', 'pgEnum', 'pgEnumWithSchema'],
      message: msg('L9a', 'ADR-002', 'Tables are declared only in packages/db/src/<module>/tables.ts') }],
  },
  'radcore/views-in-views': {
    imports: [{ source: '^drizzle-orm/pg-core(/.*)?$',
      names: ['pgView', 'pgViewWithSchema', 'pgMaterializedView', 'pgMaterializedViewWithSchema'],
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
      sel('E1', 'ADR-001', 'The define* helpers come from @radcore/lib-platform')(
        "ImportDeclaration:not([source.value='@radcore/lib-platform']) > ImportSpecifier[local.name=/^define/]"),
    ],
    onlyImports: { source: '^@radcore/lib-[a-z]+(-[a-z]+)*(/contract)?$',
      message: msg('E1', 'ADR-001', "Route and job files import only libraries' . and ./contract entries") },
  },
  'radcore/e3-no-io': {
    // The global objects count only when they are the real globals, so a local `window` (a financial-year window)
    // is fine.
    globals: ['process', 'fetch', 'setTimeout', 'setInterval', 'setImmediate', 'crypto', 'performance',
      'globalThis', 'global', 'window', 'self'].map((name) => ({ name, message: msg('E3', 'ADR-001', E3) })),
    syntax: [
      "MemberExpression[object.name='Math'][property.name='random']",
      "MemberExpression[object.name='Math'][property.value='random']",
      "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      "CallExpression[callee.name='Date']",
      "NewExpression[callee.name='Date'][arguments.length=0]",
    ].map(sel('E3', 'ADR-001', E3)),
  },
  'radcore/e4-no-escape': {
    syntax: [
      "TSAsExpression[typeAnnotation.type=/^TS(Any|Unknown)Keyword$/]",
      "TSTypeAssertion[typeAnnotation.type=/^TS(Any|Unknown)Keyword$/]",
      "MemberExpression[property.name='Reflect']",
    ].map(sel('E4', 'ADR-001', 'No cast or reflection past the type checker')),
    globals: [{ name: 'Reflect', message: msg('E4', 'ADR-001', 'No reflection in libraries') }],
    imports: [{ source: '^drizzle-orm(/.*)?$', names: ['getTableConfig'],
      message: msg('E4', 'ADR-001', 'Libraries do not read table metadata') }],
  },
  'radcore/d7-no-db-reexport': {
    sources: ['^@radcore/db(/|$)', '^\\.{1,2}/(.*/)?db(/|$)'],
    message: msg('D7', 'ADR-001', "A library never hands on @radcore/db's tables or transactions, or lib-platform's db/"),
  },
  'radcore/d7-no-table-exports': {
    names: ['PgTable', 'PgTableWithColumns', 'PgColumn', 'PgView', 'PgViewWithSelection', 'PgMaterializedView',
      'PgMaterializedViewWithSelection', 'PgSchema', 'PgDatabase', 'PgTransaction', 'NodePgDatabase'],
    txPattern: '^(Platform|Hr|Gst|Ops|Accounts|Crm|Stock|Payroll|Purchasing|Sales|Service)Tx$',
    message: msg('D7', 'ADR-001', "A library's entry never exports a table, view, column, database or module transaction"),
  },
  'radcore/no-subpath-imports': {
    imports: [{ source: '^#', message: '[L4] No package.json "imports" aliases: they hide the real specifier from L1, L4, L8 and L9 (ADR-002).' }],
  },
  'radcore/no-declare': {
    syntax: ['VariableDeclaration[declare=true]', 'TSModuleDeclaration[declare=true]', 'TSDeclareFunction',
      'ClassDeclaration[declare=true]', 'TSEnumDeclaration[declare=true]']
      .map(sel('E4', 'ADR-001', 'No ambient declarations outside .d.ts: they hide globals such as fetch and Reflect')),
  },
};
const on = (id, options = OPTIONS[id]) => ({ [id]: ['error', options] });
const L1_BASE = OPTIONS['radcore/no-sql'];
const L1_ZONE = { allowNames: [...L1_ALLOW, 'sql'], zone: true };

export default tseslint.config(
  { ignores: ['node_modules/**', 'apps/*/node_modules/**', 'packages/*/node_modules/**', 'apps/web/.next/**',
    'apps/web/next-env.d.ts', 'coverage/**', 'tools/boundary-fixtures/**'] },
  // ADR-002: no comment can switch a rule off.
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' } },
  ...tseslint.configs.recommended,
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { plugins: { radcore, drizzle } },

  // E2 file size, E5 no switching the type checker off, and the guards that keep the other rules honest.
  { files: ALL, rules: {
    'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
    '@typescript-eslint/ban-ts-comment': ['error',
      { 'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true, 'ts-check': true }],
    ...on('radcore/no-subpath-imports'),
  } },
  { files: ALL, ignores: ['**/*.d.ts'], rules: on('radcore/no-declare') },

  // L1: on everywhere; its SQL zone, allowlist extras and test files get their own options below.
  { files: ALL, rules: on('radcore/no-sql') },
  { files: L1_SQL_ZONE, rules: on('radcore/no-sql', L1_ZONE) },
  { files: [REQUEST_CONTEXT], rules: on('radcore/no-sql', { ...L1_ZONE, helper: REQUEST_CONTEXT_HELPER }) },
  ...Object.entries(L1_EXTRA_NAMES).map(([file, names]) =>
    ({ files: [file], rules: on('radcore/no-sql', { allowNames: [...L1_ALLOW, ...names] }) })),
  { files: [`**/*.test.${EXT}`], rules: on('radcore/no-sql', { ...L1_BASE, importExpressions: false }) },

  // Server code: L2, L3, L5, L8, each off only in its zone.
  { files: SERVER, ignores: ZONES['radcore/no-query-strings'], rules: on('radcore/no-query-strings') },
  { files: SERVER, ignores: ZONES['radcore/no-raw-execution'], rules: on('radcore/no-raw-execution') },
  // The timer globals are declared so no-implied-eval knows them.
  { files: SERVER, languageOptions: { globals: { setTimeout: 'readonly', setInterval: 'readonly', setImmediate: 'readonly' } },
    rules: {
    'drizzle/enforce-update-with-where': ['error', { drizzleObjectName: ['tx', 'db'] }],
    'drizzle/enforce-delete-with-where': ['error', { drizzleObjectName: ['tx', 'db'] }],
    // L8: no code loaded from a string.
    'no-eval': 'error', 'no-new-func': 'error', 'no-implied-eval': 'error',
  } },
  { files: SERVER, ignores: ZONES['radcore/outbound-only'], rules: on('radcore/outbound-only') },

  // Everywhere: L4, L6, L9a, L9b.
  { files: ALL, ignores: ZONES['radcore/no-driver'], rules: on('radcore/no-driver') },
  { files: ALL, rules: on('radcore/no-raw-html') },
  { files: ALL, ignores: ZONES['radcore/tables-in-schema'], rules: on('radcore/tables-in-schema') },
  { files: ALL, ignores: ZONES['radcore/views-in-views'], rules: on('radcore/views-in-views') },

  // E1, E3, and D7's re-export guard (lib-platform's runtime entry and its own db/ hand on the pool by design).
  { files: ['apps/api/src/routes/**', 'apps/worker/src/jobs/**'], rules: on('radcore/e1-route-files') },
  { files: ['packages/lib-common/**', 'packages/*/src/contract.ts', 'packages/*/src/rules/**'], rules: on('radcore/e3-no-io') },
  { files: [`packages/lib-*/**/*.${EXT}`], ignores: ['packages/lib-platform/src/runtime.ts', 'packages/lib-platform/src/db/**'],
    rules: on('radcore/d7-no-db-reexport') },

  // E4: with type information, on libraries and packages/db's module folders outside the SQL zone. These typed
  // rules belong to E4 alone.
  { files: [`packages/lib-*/**/*.${TS}`, `packages/db/src/*/**/*.${TS}`], ignores: TABLE_FILES,
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      ...on('radcore/e4-no-escape'),
    } },

  // D7's export guard on every library entry, with the same type information.
  { files: ['packages/lib-*/src/index.ts', 'packages/lib-*/src/contract.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: on('radcore/d7-no-table-exports') },

  // The web app: Next's rules, with react/no-danger as an error and no exceptions (L6).
  ...nextVitals.map((c) => ({ ...c, files: [`apps/web/**/*.${EXT}`] })),
  { files: [`apps/web/**/*.${EXT}`], settings: { next: { rootDir: 'apps/web' } },
    rules: { 'react/no-danger': 'error' } },
);
