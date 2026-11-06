// ESLint rules from ADR-001 (E1 to E4) and ADR-002 (L1 to L6, L8). Each ADR rule has its own id, `adr/<rule>`,
// so its options never replace another's and a fixture can tell which rule fired (tools/boundaries.test.ts).
// Import-graph rules (D1 to D9, L7) are in .dependency-cruiser.cjs.
import { builtinRules } from 'eslint/use-at-your-own-risk';
import drizzle from 'eslint-plugin-drizzle';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

/** ADR-002 §"Lint rules": the only files where L1 to L3 are off. Pinned by tools/sql-zone.test.ts. */
export const SQL_ZONE = [
  'packages/db/migrations/**',
  'packages/db/views/*.ts',
  'packages/db/src/*/tables.ts',
  'packages/db/src/columns.ts',
  'packages/db/src/request-context.ts',
];

const SERVER = ['packages/**', 'apps/api/**', 'apps/worker/**'];
const DB_CLIENT = 'packages/lib-platform/src/db/client.ts';
const OUTBOUND_CLIENT = 'packages/lib-platform/src/outbound.ts';

// Aliases of core rules, one per ADR rule.
const syntax = builtinRules.get('no-restricted-syntax');
const imports = builtinRules.get('no-restricted-imports');
const globals = builtinRules.get('no-restricted-globals');
const adr = { rules: {
  'E1-syntax': syntax, 'E1-imports': imports, 'E3-syntax': syntax, 'E3-globals': globals,
  'E4-syntax': syntax, 'E4-imports': imports, L1: imports, L2: syntax, L3: syntax, L4: imports, L6: syntax,
  'L8-globals': globals, 'L8-imports': imports,
} };

const sel = (tag, selector, message) => ({ selector, message: `[${tag}] ${message}` });

// L2: string shapes of an SQL statement. shortcut: a template is checked one piece at a time, so a statement split
// across `${}` before its second keyword escapes; L1 still catches the `sql` tag, and review catches the rest.
const SQL_SHAPE = String.raw`/\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\s+from\b|\bwith\b[\s\S]*\bas\s*\(|\b(create|alter|drop)\s+(or\s+replace\s+)?(table|view|index|trigger|function)\b|\btruncate\s+(table\b|\w+\s*;?$)|\bgrant\b[\s\S]*\b(on|to)\b/i`;
const DEFINE = '/^define(Route|Webhook|Job|Export|Import|Approval)$/';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts', 'coverage/**', 'tools/boundary-fixtures/**',
    'packages/db/migrations/meta/**'] },
  ...tseslint.configs.recommended,
  { plugins: { adr } },
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },

  // E2: file size, tests included.
  { files: ['apps/**/*.{ts,tsx,js,mjs}', 'packages/**/*.{ts,tsx,js,mjs}'],
    rules: { 'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }] } },

  // L1: no `sql` template outside the SQL zone (everywhere, the web app included).
  { files: ['**/*.{ts,tsx,js,mjs}'], ignores: SQL_ZONE,
    rules: { 'adr/L1': ['error', {
      paths: [{ name: 'drizzle-orm', importNames: ['sql'], message: '[L1] sql templates live only in the SQL zone (ADR-002).' }],
      patterns: [{ group: ['drizzle-orm/*'], importNames: ['sql'], message: '[L1] sql templates live only in the SQL zone (ADR-002).' }],
    }] } },

  // L2, L3: no query strings and no raw execution in server code outside the SQL zone.
  { files: SERVER, ignores: SQL_ZONE, rules: {
    'adr/L2': ['error',
      sel('L2', `Literal[value=${SQL_SHAPE}]`, 'This string is shaped like SQL. Use Drizzle, or reword the message (ADR-002).'),
      sel('L2', `TemplateElement[value.raw=${SQL_SHAPE}]`, 'This template is shaped like SQL. Use Drizzle (ADR-002).')],
    'adr/L3': ['error', sel('L3', 'CallExpression[callee.property.name=/^(execute|unsafe|query)$/]',
      'No raw execution of SQL text (ADR-002).')],
  } },

  // L4: drivers only in lib-platform's database client.
  { files: ['**/*.{ts,tsx,js,mjs}'], ignores: [DB_CLIENT], rules: { 'adr/L4': ['error', {
    paths: ['pg', 'postgres', '@electric-sql/pglite', 'drizzle-orm/node-postgres', 'drizzle-orm/pglite']
      .map((name) => ({ name, message: `[L4] Only ${DB_CLIENT} opens connections (ADR-002).` })),
  }] } },

  // L5: updates and deletes have a where.
  { files: SERVER, plugins: { drizzle }, rules: {
    'drizzle/enforce-update-with-where': ['error', { drizzleObjectName: ['tx', 'db'] }],
    'drizzle/enforce-delete-with-where': ['error', { drizzleObjectName: ['tx', 'db'] }],
  } },

  // L6: no raw HTML. react/no-danger is set for apps/web below.
  { files: ['**/*.{ts,tsx,js,mjs}'], rules: { 'adr/L6': ['error',
    sel('L6', 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]', 'No raw HTML (ADR-002).')] } },

  // L8: outside calls only through the guarded client.
  // Tests may call the local server under test; they never ship.
  { files: SERVER, ignores: [OUTBOUND_CLIENT, '**/*.test.ts'], rules: {
    'adr/L8-globals': ['error', { name: 'fetch', message: `[L8] Outside calls go through ${OUTBOUND_CLIENT} (ADR-002).` }],
    'adr/L8-imports': ['error', { paths: ['undici', 'axios', 'got', 'node:http', 'node:https', 'http', 'https']
      .map((name) => ({ name, message: `[L8] Outside calls go through ${OUTBOUND_CLIENT} (ADR-002).` })) }],
  } },

  // E1: route and job files hold only define* calls.
  { files: ['apps/api/src/routes/**', 'apps/worker/src/jobs/**'], rules: {
    'adr/E1-syntax': ['error',
      ...['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'IfStatement', 'SwitchStatement',
        'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'ConditionalExpression',
        'LogicalExpression', 'UpdateExpression', "AssignmentExpression[operator!='=']"]
        .map((s) => sel('E1', s, 'Route and job files hold only define* calls; put the rule in the library (ADR-001).')),
      ...["'+'", "'-'", "'*'", "'/'", "'%'", "'**'"].map((op) =>
        sel('E1', `BinaryExpression[operator=${op}]`, 'No arithmetic in a route or job file (ADR-001).')),
      sel('E1', `CallExpression:not([callee.name=${DEFINE}])`, 'Only define* calls here (ADR-001).'),
      sel('E1', 'CallExpression > CallExpression.arguments', 'A define* argument must not be a call (ADR-001).')],
    'adr/E1-imports': ['error', { patterns: [{ regex: '^(?!@radcore/lib-[a-z]+(-[a-z]+)*(/contract)?$)',
      message: "[E1] Route and job files import only libraries' . and ./contract entries (ADR-001)." }] }],
  } },

  // E3: no I/O without an import in lib-common, contracts and rules.
  { files: ['packages/lib-common/**', 'packages/*/src/contract.ts', 'packages/*/src/rules/**'], rules: {
    'adr/E3-globals': ['error', ...['process', 'fetch', 'setTimeout', 'setInterval', 'crypto'].map((name) =>
      ({ name, message: '[E3] Pass time, randomness and I/O in as arguments or through ctx (ADR-001).' }))],
    'adr/E3-syntax': ['error',
      sel('E3', "MemberExpression[object.name='Math'][property.name='random']", 'No Math.random here (ADR-001).'),
      sel('E3', "CallExpression[callee.object.name='Date'][callee.property.name='now']", 'No Date.now() here; use ctx.clock (ADR-001).'),
      sel('E3', "NewExpression[callee.name='Date'][arguments.length=0]", 'No new Date() here; use ctx.clock (ADR-001).')],
  } },

  // E4: no escape hatch in libraries.
  { files: ['packages/lib-*/**'], rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    'adr/E4-syntax': ['error',
      sel('E4', "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']", 'No double cast (ADR-001).'),
      sel('E4', "TSAsExpression[typeAnnotation.type='TSAnyKeyword']", 'No cast to any (ADR-001).')],
    'adr/E4-imports': ['error', { paths: ['drizzle-orm', 'drizzle-orm/pg-core'].map((name) =>
      ({ name, importNames: ['getTableConfig'], message: '[E4] Libraries do not read table metadata (ADR-001).' })) }],
  } },

  // The web app: Next's rules, with react/no-danger as an error and no exceptions (L6).
  ...nextVitals.map((c) => ({ ...c, files: ['apps/web/**/*.{ts,tsx,js,mjs}'] })),
  { files: ['apps/web/**/*.{ts,tsx,js,mjs}'], settings: { next: { rootDir: 'apps/web' } },
    rules: { 'react/no-danger': 'error' } },
);
