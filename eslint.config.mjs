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
const IMPORT_ISOLATE = 'packages/lib-platform/src/import/isolate.ts';
/** The one function in request-context.ts whose body may use `sql` (ADR-002 §3). */
export const REQUEST_CONTEXT_HELPER = 'applyRequestContext';

/** ADR-002 "Each rule's zone": the exact files where each rule is off. Pinned by tools/eslint-config.test.ts. */
export const ZONES = {
  'radcore/no-query-strings': [VIEW_FILES, REQUEST_CONTEXT],
  'radcore/no-raw-execution': [REQUEST_CONTEXT, 'packages/db/src/migrate.ts'],
  'radcore/no-driver': [DB_CLIENT, 'packages/db/src/migrate.ts'],
  'radcore/tables-in-schema': TABLE_FILES,
  'radcore/views-in-views': [VIEW_FILES],
  'radcore/outbound-only': [OUTBOUND_CLIENT],
};
/** L8's import list lifted by one module in exactly these files, with the rest of L8 still on (ADR-002). */
export const L8_LIFTED = { [IMPORT_ISOLATE]: ['worker_threads'] };
/** L1's SQL zone: `sql` allowed in its positions (plus `sql` on the allowlist). L1 itself is never off. */
export const L1_SQL_ZONE = [VIEW_FILES, ...TABLE_FILES, REQUEST_CONTEXT];
const L1_ALLOW = ['and', 'or', 'not', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull', 'inArray', 'between',
  'like', 'ilike', 'asc', 'desc', 'count', 'countDistinct', 'sum', 'avg', 'min', 'max', 'exists'];
/** L1's per-file allowlist additions (ADR-002), with the rest of L1 still on. */
export const L1_EXTRA_NAMES = {
  'packages/db/src/*/relations.ts': ['relations'],
  'packages/db/src/conditions.ts': ['notInArray'],
  'packages/db/src/module-tx.ts': ['getOperators', 'getOrderByOperators', 'is', 'getTableName'],
  'packages/db/src/migrate.ts': ['drizzle', 'migrate'],
  'packages/lib-platform/src/db/client.ts': ['drizzle'],
};

const msg = (tag, adr, text) => `[${tag}] ${text} (${adr}).`;
const sel = (tag, adr, text) => (selector) => ({ selector, message: msg(tag, adr, text) });
// Statement shapes, with \W+ between keywords so a comment or other separator doesn't hide them.
const SQL_SHAPE = String.raw`/\bselect\b[\s\S]*\bfrom\b|\binsert\W+into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\W+from\b|\bwith\b[\s\S]*\bas\W*\(|\b(create|alter|drop)\W+(or\W+replace\W+)?(table|view|index|trigger|function)\b|\btruncate\W+(table\b|\w+\W*$)|\bgrant\b[\s\S]*\b(on|to)\b/i`;
const DEFINE = '/^define(Route|Webhook|Job|Export|Import|Approval)$/';
const RAW_EXEC = '/^(execute|unsafe|query)$/';
const L8 = msg('L8', 'ADR-002', `Outside calls and module loading go through ${OUTBOUND_CLIENT}`);
const L8_MODULES = ['undici', 'axios', 'got', 'node-fetch', 'ws', 'http', 'https', 'http2', 'net', 'tls', 'dgram',
  'child_process', 'module', 'worker_threads', 'vm', 'inspector', 'cluster'];
// outbound.ts's raw https transport sends without the client's origin and address checks. Only
// tools/outbound-tls.test.ts, which isn't server code, may import it (RAD-44, auditor-2).
const L8_TRANSPORT = { source: '(^|/)outbound(\\.ts)?$', names: ['nodeTransport'], message: L8 };
const l8Imports = (modules) => [{ source: `^(node:)?(${modules.join('|')})(/.*)?$`, message: L8 }, L8_TRANSPORT];
// E6: a name that holds money, a rate or a quantity: the whole name (`total`), a camelCase, ALL-CAPS or snake_case
// ending (`grandTotal`, `totalGST`, `unit_price`), singular or plural. `generate` and `separate` don't match. A word
// in SUFFIX_ONLY counts only as a camelCase ending, so a page's `limit` and `MAX_LIMIT` are numbers but `creditLimit`
// is money. tools/e6-words.test.ts lints a sample for every word.
export const MONEY_WORDS = ['amount', 'price', 'rate', 'total', 'subtotal', 'cost', 'qty', 'quantity', 'balance', 'tax',
  'cess', 'paise', 'rupees', 'money', 'discount', 'mrp', 'fee', 'charge', 'gst', 'cgst', 'sgst', 'igst', 'tds', 'tcs',
  'freight', 'roundOff', 'salary', 'gross', 'net', 'wage', 'pay', 'outstanding', 'due', 'payable', 'receivable', 'debit',
  'credit', 'interest', 'commission', 'advance', 'refund'];
export const SUFFIX_ONLY = ['limit'];
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const snake = (w) => w.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const alt = (ws) => ws.join('|');
const UPPER = MONEY_WORDS.map((w) => w.toUpperCase());
const MONEY_NAME = `/^(${alt(MONEY_WORDS)}|${alt(UPPER)})s?$`
  + `|[a-z0-9_](${alt([...MONEY_WORDS, ...SUFFIX_ONLY].map(cap))}|${alt(UPPER)})s?$|_(${alt(MONEY_WORDS.map(snake))})s?$/`;
const E6 = msg('E6', 'ADR-001', 'No floating-point maths or text comparison on money, rates or quantities. Use '
  + "@radcore/lib-common's decimal helpers: dec(a).plus(b), dec(a).gt(b), dec(a).eq(b)");
const MONEY = `:matches(Identifier[name=${MONEY_NAME}], MemberExpression[property.name=${MONEY_NAME}])`;
// An operand is the money value itself, or one wrapped in ?., !, as, satisfies or a spread.
const WRAPPED = ':matches(ChainExpression, TSNonNullExpression, TSAsExpression, TSSatisfiesExpression, SpreadElement)';
const operands = (parent) => [`${parent} > ${MONEY}`, `${parent} > ${WRAPPED} ${MONEY}`];
const NOT_STRING_PLUS = "BinaryExpression[operator='+']:not([left.type='TemplateLiteral']):not([right.type='TemplateLiteral'])"
  + ':not([left.value=type(string)]):not([right.value=type(string)])';
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
    // The real global object only (resolved by scope), read only as `G.key` for keys not listed here; `deps.fetch` is fine.
    globalMembers: { objects: ['globalThis', 'global', 'window', 'self'], members: ['fetch', 'WebSocket', 'XMLHttpRequest'],
      message: L8 },
    syntax: [
      "MemberExpression[property.name='getBuiltinModule']",
      "MemberExpression[property.value='getBuiltinModule']",
      "MemberExpression[property.quasis.0.value.cooked='getBuiltinModule']",
      // Destructuring it, by any spelling of the key: `const { getBuiltinModule: load } = process`.
      "ObjectPattern > Property[key.name='getBuiltinModule']",
      "ObjectPattern > Property[key.value='getBuiltinModule']",
      "ObjectPattern > Property[key.quasis.0.value.cooked='getBuiltinModule']",
    ].map((selector) => ({ selector, message: L8 })),
    imports: l8Imports(L8_MODULES),
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
  'radcore/e6-no-float-money': {
    // shortcut: money is found by name, without type information, so `Number(x)` on a value named `n` passes; the
    // wire types (decimal strings) make arithmetic on an unconverted value a type error, so the gap is the converted one.
    globals: [{ name: 'parseFloat', message: E6 }],
    syntax: [
      "MemberExpression[object.name='Number'][property.name='parseFloat']",
      // A conversion with money anywhere inside it: Number(line.amount || 0), Number(l?.qty), Math.max(...amounts).
      `CallExpression[callee.name='Number'] ${MONEY}`,
      `CallExpression[callee.object.name='Math'] ${MONEY}`,
      `UnaryExpression[operator=/^[-+]$/] ${MONEY}`,
      // Arithmetic, and comparison (decimal strings compare as text: "9.00" > "10.00").
      ...["'-'", "'*'", "'/'", "'%'", "'**'", "'<'", "'<='", "'>'", "'>='"]
        .flatMap((op) => operands(`BinaryExpression[operator=${op}]`)),
      ...operands(NOT_STRING_PLUS),
      `AssignmentExpression[operator=/^([-+*%]|\\*\\*)=$/] > ${MONEY}.left`,
      `AssignmentExpression[operator='/='] > ${MONEY}.left`,
      ...operands('UpdateExpression'),
      // Equality between two money values ("10.0" !== "10.00"); against null or a literal is fine.
      ...['name', 'property.name'].flatMap((l) => ['name', 'property.name'].map((r) =>
        `BinaryExpression[operator=/^[!=]==?$/][left.${l}=${MONEY_NAME}][right.${r}=${MONEY_NAME}]`)),
      // Declaring money as a number, in any form: `amount: number | null`, `amounts: number[]`,
      // `total: z.coerce.number()`, `price: z.number().int().min(0)`, `tax: z.optional(z.number())`.
      `TSPropertySignature[key.name=${MONEY_NAME}] TSNumberKeyword`,
      `Identifier[name=${MONEY_NAME}] > TSTypeAnnotation TSNumberKeyword`,
      `Property[key.name=${MONEY_NAME}] CallExpression[callee.property.name='number']`,
    ].map((selector) => ({ selector, message: E6 })),
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
  // Within L1's own scope only (apps/ and packages/): tools/ is repo tooling, not server code.
  { files: [`apps/**/*.test.${EXT}`, `packages/**/*.test.${EXT}`], rules: on('radcore/no-sql', { ...L1_BASE, importExpressions: false }) },

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
  ...Object.entries(L8_LIFTED).map(([file, lifted]) => ({ files: [file], rules: on('radcore/outbound-only',
    { ...OPTIONS['radcore/outbound-only'], imports: l8Imports(L8_MODULES.filter((m) => !lifted.includes(m))) }) })),

  // Everywhere: L4, L6, L9a, L9b.
  { files: ALL, ignores: ZONES['radcore/no-driver'], rules: on('radcore/no-driver') },
  { files: ALL, rules: on('radcore/no-raw-html') },
  // E6: no float maths on money, in the browser and the server alike (RC-215).
  { files: ALL, rules: on('radcore/e6-no-float-money') },
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
    rules: { 'react/no-danger': 'error',
      // RC-146: a link to a new tab carries rel="noopener noreferrer" (COOP in next.config.ts also cuts the opener).
      'react/jsx-no-target-blank': ['error', { allowReferrer: false, enforceDynamicLinks: 'always', forms: true }] } },
);
