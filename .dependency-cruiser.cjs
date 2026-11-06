// Import-graph rules from ADR-001 (D1 to D9) and ADR-002 (L7). In-file rules are in eslint.config.mjs.
// Every path pattern accepts the tools/boundary-fixtures/<rule>/ prefix, so a fixture is judged as if it sat at its
// mirrored path in the repo (tools/boundaries.test.ts). The normal run cruises only packages/ and apps/.
const { builtinModules } = require('node:module');

// An empty alternative rather than `?`: dependency-cruiser refuses nested quantifiers as unsafe regexes.
const F = '^(?:tools/boundary-fixtures/[^/]+/|)';
const pkg = (names) => `${F}packages/(${names.join('|')})/`;
const ENTRIES = `${F}packages/(lib-[^/]+/src/(index|contract)\\.ts|lib-platform/src/runtime\\.ts`
  + '|db/(src/[^/]+/index\\.ts|views/index\\.ts|src/(schema|request-context|migrate)\\.ts))$';
const NODE_BUILTIN = `^(node:)?(${builtinModules.join('|')})$`;
// D5: what a contract may never reach. lib-platform's contract may reach its other browser-safe files, so only its
// `.` and `./runtime` count. Another library's `.` counts too: ADR-001 §2 lets a contract import only zod, lib-common
// and other libraries' contract entries.
const CONTRACT_UNSAFE = `${F}packages/db/|${F}packages/lib-(?!common/)[^/]+/src/(index|runtime)\\.ts$|/src/services/`;
const RULES_UNSAFE = `${F}packages/(db|lib-platform)/|/src/services/`;

// ADR-001 §4: the other @radcore packages each workspace may import.
const BASE = ['lib-common', 'lib-platform', 'db'];
const MODULES = ['integrations', 'hr', 'gst', 'ops', 'accounts', 'crm', 'stock', 'payroll', 'purchasing', 'sales', 'service']
  .map((m) => `lib-${m}`);
const MAY_IMPORT = {
  'packages/lib-common': [],
  'packages/db': ['lib-common'],
  'packages/lib-platform': ['lib-common', 'db'],
  'packages/lib-integrations': ['lib-common', 'lib-platform'],
  'packages/lib-hr': BASE,
  'packages/lib-gst': [...BASE, 'lib-integrations'],
  'packages/lib-ops': [...BASE, 'lib-hr'],
  'packages/lib-accounts': [...BASE, 'lib-gst', 'lib-integrations'],
  'packages/lib-crm': [...BASE, 'lib-accounts', 'lib-ops', 'lib-integrations'],
  'packages/lib-stock': [...BASE, 'lib-accounts', 'lib-gst', 'lib-integrations'],
  'packages/lib-payroll': [...BASE, 'lib-hr', 'lib-accounts'],
  'packages/lib-purchasing': [...BASE, 'lib-stock', 'lib-accounts', 'lib-gst'],
  'packages/lib-sales': [...BASE, 'lib-stock', 'lib-accounts', 'lib-gst', 'lib-crm', 'lib-integrations'],
  'packages/lib-service': [...BASE, 'lib-sales', 'lib-stock', 'lib-accounts', 'lib-purchasing', 'lib-ops'],
  'apps/api': ['lib-common', 'lib-platform', ...MODULES],
  'apps/worker': ['lib-common', 'lib-platform', ...MODULES],
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  // D2: anything not listed here fails as `not-in-allowed`.
  allowedSeverity: 'error',
  allowed: [
    { from: {}, to: { path: '(^|/)node_modules/' } },
    { from: {}, to: { dependencyTypes: ['core'] } },
    { from: { path: `${F}(packages|apps)/([^/]+)/` }, to: { path: `${F}$1/$2/` } },
    ...Object.entries(MAY_IMPORT).filter(([, to]) => to.length)
      .map(([from, to]) => ({ from: { path: `${F}${from}/` }, to: { path: pkg(to) } })),
    { from: { path: `${F}apps/web/` }, to: { path: [`${F}packages/lib-common/`, `${F}packages/lib-[^/]+/src/contract\\.ts$`] } },
  ],
  forbidden: [
    { name: 'D1-no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'D3-no-deep-import', severity: 'error', comment: 'Import another package only through its declared entries.',
      from: { path: `${F}(packages|apps)/([^/]+)/` },
      to: { path: `${F}packages/`, pathNot: [`${F}packages/$2/`, ENTRIES] } },
    { name: 'D3-unresolvable', severity: 'error', comment: "A specifier the target's exports refuse does not resolve.",
      from: {}, to: { couldNotResolve: true } },
    { name: 'D4-web-server-code', severity: 'error', from: { path: `${F}apps/web/` },
      to: { path: [pkg(['db']), `${F}packages/lib-(?!common/)[^/]+/src/(index|runtime)\\.ts$`] } },
    { name: 'D4-web-node-builtin', severity: 'error', comment: 'next.config.* and scripts/** are exempt (ADR-001 D4).',
      from: { path: `${F}apps/web/`, pathNot: `${F}apps/web/(next\\.config\\.[^/]+$|scripts/)` },
      to: { dependencyTypes: ['core'] } },
    { name: 'D5-contract-server-code', severity: 'error', from: { path: 'src/contract\\.ts$' },
      to: { path: CONTRACT_UNSAFE, reachable: true } },
    { name: 'D5-contract-node-builtin', severity: 'error', from: { path: 'src/contract\\.ts$' },
      to: { path: NODE_BUILTIN, reachable: true } },
    { name: 'D6-rules-pure', severity: 'error', from: { path: '/src/rules/' }, to: { path: RULES_UNSAFE } },
    { name: 'D7-other-module-tables', severity: 'error', from: { path: `${F}packages/lib-([^/]+)/` },
      to: { path: `${F}packages/db/src/[^/]+/index\\.ts$`, pathNot: `${F}packages/db/src/$1/` } },
    { name: 'D7-tables-only-from-libraries', severity: 'error', from: { pathNot: pkg(['lib-[^/]+', 'db']) },
      to: { path: `${F}packages/db/src/[^/]+/index\\.ts$` } },
    { name: 'D7-platform-entries', severity: 'error', from: { pathNot: pkg(['lib-platform', 'db']) },
      to: { path: `${F}packages/db/src/(platform/index|schema|request-context|migrate)\\.ts$` } },
    { name: 'D8-apps-no-db', severity: 'error', from: { path: `${F}apps/(api|worker)/` }, to: { path: pkg(['db']) } },
    { name: 'D9-no-http-in-packages', severity: 'error', from: { path: `${F}packages/` },
      to: { path: ['(^|/)node_modules/(express|next)/', `${F}apps/`] } },
    { name: 'L7-runtime-only-in-apps', severity: 'error', from: { pathNot: `${F}apps/(api|worker)/` },
      to: { path: `${F}packages/lib-platform/src/runtime\\.ts$` } },
  ],
  options: {
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: { path: '(^|/)\\.next/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.d.ts'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
