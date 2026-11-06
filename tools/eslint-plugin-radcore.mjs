// The local ESLint plugin for ADR-001's E-rules and ADR-002's L-rules. Each ADR rule is its own rule here, so a later
// config block can never replace another rule's options (ADR-001 "One ESLint rule per E-rule"). Selectors and
// patterns live in eslint.config.mjs as each rule's options, where tools/eslint-config.test.ts pins them.

/**
 * A rule that refuses syntax, globals and imports, all given as options:
 *   syntax:  [{ selector, message }]                       esquery selectors
 *   globals: [{ name, message }]                           references to an undeclared global
 *   imports: [{ source, names?, message }]                 source is a regex; with names, only those value imports
 *   onlyImports: { source, message }                       every import must match source (E1)
 */
const restrict = (description) => ({
  meta: { type: 'problem', docs: { description }, schema: false, messages: { m: '{{message}}' } },
  create(context) {
    const o = context.options[0] ?? {};
    const report = (node, message) => context.report({ node, messageId: 'm', data: { message } });
    const listeners = {};
    const on = (selector, fn) => {
      const prev = listeners[selector];
      listeners[selector] = prev ? (n) => { prev(n); fn(n); } : fn;
    };
    for (const { selector, message } of o.syntax ?? []) on(selector, (n) => report(n, message));

    const imports = (o.imports ?? []).map((i) => ({ ...i, re: new RegExp(i.source) }));
    const only = o.onlyImports && { ...o.onlyImports, re: new RegExp(o.onlyImports.source) };
    // specifiers: value-imported names, or null for an import that brings in the whole module.
    const checkSource = (node, source, specifiers) => {
      if (typeof source !== 'string') return;
      if (only && !only.re.test(source)) report(node, only.message);
      for (const rule of imports) {
        if (!rule.re.test(source)) continue;
        if (!rule.names) report(node, rule.message);
        else if (specifiers === null || specifiers.some((n) => rule.names.includes(n))) report(node, rule.message);
      }
    };
    const valueNames = (specs) => {
      if (specs.some((s) => s.type !== 'ImportSpecifier' && s.type !== 'ExportSpecifier')) return null;
      return specs.filter((s) => s.importKind !== 'type' && s.exportKind !== 'type')
        .map((s) => (s.imported ?? s.local).name ?? (s.imported ?? s.local).value);
    };
    on('ImportDeclaration', (n) => checkSource(n, n.source.value, n.importKind === 'type' ? [] : valueNames(n.specifiers)));
    on('ExportNamedDeclaration[source]', (n) => checkSource(n, n.source.value, n.exportKind === 'type' ? [] : valueNames(n.specifiers)));
    on('ExportAllDeclaration', (n) => checkSource(n, n.source.value, null));
    on('ImportExpression', (n) => checkSource(n, n.source.value, null));
    on("CallExpression[callee.name='require']", (n) => checkSource(n, n.arguments[0]?.value, null));

    const globals = new Map((o.globals ?? []).map((g) => [g.name, g.message]));
    if (globals.size) {
      on('Program:exit', (program) => {
        const scope = context.sourceCode.getScope(program);
        const refs = [...scope.through, ...scope.variables.filter((v) => v.defs.length === 0).flatMap((v) => v.references)];
        for (const ref of refs) {
          const message = globals.get(ref.identifier.name);
          if (message) report(ref.identifier, message);
        }
      });
    }
    return listeners;
  },
});

// L1's positions (ADR-002 §3): inside the SQL zone, `sql` may appear only as the argument of these calls.
const ALLOWED_CALL = (call) => {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name === 'check';
  if (c.type !== 'MemberExpression' || c.computed) return false;
  if (['default', 'generatedAlwaysAs'].includes(c.property.name)) return true;
  return c.property.name === 'as' && c.object.type === 'CallExpression' && c.object.callee.name === 'pgView';
};
const isFunction = (n) => /Function/.test(n.type);

/**
 * L1, no `sql` outside its positions. Options:
 *   allowNames: value imports allowed from drizzle-orm (outside the zone)
 *   zone: true in the SQL zone files: the allowlist is off and `sql` may appear in ALLOWED_CALL arguments
 *   helperBodies: true in request-context.ts: `sql` may also appear inside a function body
 *   importExpressions: false in test files, which may use import() for mocking
 */
const noSql = {
  meta: { type: 'problem', docs: { description: 'ADR-002 L1' }, schema: false, messages: { m: '{{message}}' } },
  create(context) {
    const o = { importExpressions: true, ...context.options[0] };
    const report = (node, message) => context.report({ node, messageId: 'm', data: { message: `[L1] ${message} (ADR-002).` } });
    const allowed = (node) => {
      if (!o.zone) return false;
      if (node.parent.type === 'ImportSpecifier') return true;
      for (let child = node, p = node.parent; p; child = p, p = p.parent) {
        if (p.type === 'CallExpression' && p.arguments.includes(child) && ALLOWED_CALL(p)) return true;
        if (o.helperBodies && isFunction(p)) return true;
      }
      return false;
    };
    const isDataKey = (n) => n.parent.type === 'Property' && n.parent.key === n && !n.parent.computed
      && !n.parent.shorthand && n.parent.parent.type === 'ObjectExpression';
    return {
      Identifier(n) {
        if (n.name === 'sql' && !isDataKey(n) && !allowed(n)) report(n, 'No sql outside its positions in the SQL zone');
      },
      'MemberExpression[computed=true]'(n) {
        const p = n.property;
        const key = p.type === 'Literal' ? p.value : p.type === 'TemplateLiteral' && p.expressions.length === 0 ? p.quasis[0].value.cooked : null;
        if (key === 'sql') report(n, 'No sql through a computed member');
      },
      ImportExpression(n) {
        if (o.importExpressions) report(n, 'No import() expressions');
      },
      ImportDeclaration(n) {
        const src = n.source.value;
        if (o.zone || n.importKind === 'type') return;
        if (/^drizzle-orm\/sql(\/|$)/.test(src)) return report(n, 'No imports from drizzle-orm/sql');
        if (src !== 'drizzle-orm') return;
        for (const s of n.specifiers) {
          if (s.type !== 'ImportSpecifier') report(s, 'Import drizzle-orm helpers by name, from the allowlist');
          else if (s.importKind !== 'type' && !o.allowNames.includes(s.imported.name)) {
            report(s, `${s.imported.name} is not on the drizzle-orm allowlist`);
          }
        }
      },
    };
  },
};

export default {
  meta: { name: 'radcore' },
  rules: {
    'e1-route-files': restrict('ADR-001 E1: route and job files hold only define* calls'),
    'e3-no-io': restrict('ADR-001 E3: no I/O without an import'),
    'e4-no-escape': restrict('ADR-001 E4: no escape hatch in libraries'),
    'no-sql': noSql,
    'no-query-strings': restrict('ADR-002 L2: no query strings'),
    'no-raw-execution': restrict('ADR-002 L3: no raw execution'),
    'no-driver': restrict('ADR-002 L4: no driver outside the pool'),
    'no-raw-html': restrict('ADR-002 L6: no raw HTML'),
    'outbound-only': restrict('ADR-002 L8: outside calls go through the guarded client'),
    'tables-in-schema': restrict('ADR-002 L9a: tables are declared only in the schema'),
    'views-in-views': restrict('ADR-002 L9b: views are declared only in views'),
  },
};
