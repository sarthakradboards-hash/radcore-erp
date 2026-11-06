// The local ESLint plugin for ADR-001's E-rules and ADR-002's L-rules. Each ADR rule is its own rule here, so a later
// config block can never replace another rule's options (ADR-001 "One ESLint rule per E-rule"). Selectors and
// patterns live in eslint.config.mjs as each rule's options; tools/eslint-options.json pins them.

const DRIZZLE = /^drizzle-orm(\/|$)/;

// A string the source code names statically: a literal, or a template with no `${}`.
const staticString = (n) => {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
  return null;
};
const findVariable = (scope, name) => {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name);
    if (v) return v;
  }
  return null;
};
// The module an identifier was imported from, or null.
const importSource = (context, id) => {
  const v = id.type === 'Identifier' ? findVariable(context.sourceCode.getScope(id), id.name) : null;
  const def = v?.defs[0];
  return def?.type === 'ImportBinding' ? def.parent.source.value : null;
};
// The identifier a call or member chain starts from: `text('a').notNull().default(...)` starts from `text`.
const chainRoot = (n) => {
  for (;;) {
    if (n.type === 'CallExpression') n = n.callee;
    else if (n.type === 'MemberExpression') n = n.object;
    else return n.type === 'Identifier' ? n : null;
  }
};
const fromDrizzle = (context, n) => {
  const root = n && chainRoot(n);
  return Boolean(root && DRIZZLE.test(importSource(context, root) ?? ''));
};

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
      if (source === null) return;
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
    on('ImportExpression', (n) => checkSource(n, staticString(n.source), null));
    on("CallExpression[callee.name='require']", (n) => checkSource(n, staticString(n.arguments[0]), null));

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

/**
 * L1, no `sql` outside its positions (ADR-002 §3). Options:
 *   allowNames: the value imports allowed from drizzle-orm and its subpaths other than pg-core (on everywhere)
 *   zone: in the SQL zone files. A `sql` tag may then be the direct argument of a drizzle `check()`, a drizzle
 *         column's `.default()` or `.generatedAlwaysAs()`, or `pgView(...).as()`, and the file may export only
 *         drizzle declarations (tables, views, columns), so no zone file can hand out an SQL value of its own
 *   helper: in request-context.ts, the one function whose body may use `sql`
 *   importExpressions: false in test files, which may use import() for mocking
 */
const noSql = {
  meta: { type: 'problem', docs: { description: 'ADR-002 L1' }, schema: false, messages: { m: '{{message}}' } },
  create(context) {
    const o = { importExpressions: true, ...context.options[0] };
    const report = (node, message) => context.report({ node, messageId: 'm', data: { message: `[L1] ${message} (ADR-002).` } });
    const allowedCall = (call) => {
      const c = call.callee;
      if (c.type === 'Identifier') return c.name === 'check' && fromDrizzle(context, c);
      if (c.type !== 'MemberExpression' || c.computed) return false;
      if (['default', 'generatedAlwaysAs'].includes(c.property.name)) return fromDrizzle(context, c.object);
      return c.property.name === 'as' && c.object.type === 'CallExpression'
        && c.object.callee.type === 'Identifier' && c.object.callee.name === 'pgView' && fromDrizzle(context, c.object.callee);
    };
    // Inside the zone: within a `sql` template that is itself the direct argument of an allowed call, or in the helper.
    const allowed = (node) => {
      if (!o.zone) return false;
      if (node.parent.type === 'ImportSpecifier') return node.parent.imported.name === node.parent.local.name;
      for (let p = node.parent; p; p = p.parent) {
        if (p.type === 'TaggedTemplateExpression' && p.tag.type === 'Identifier' && p.tag.name === 'sql'
          && p.parent.type === 'CallExpression' && p.parent.arguments.includes(p) && allowedCall(p.parent)) return true;
        if (o.helper && p.type === 'FunctionDeclaration' && p.id?.name === o.helper) return true;
      }
      return false;
    };
    const isDataKey = (n) => n.parent.type === 'Property' && n.parent.key === n && !n.parent.computed
      && !n.parent.shorthand && n.parent.parent.type === 'ObjectExpression';
    // A zone export must be a drizzle declaration: a table, view or column, or a column helper returning one.
    const isDeclaration = (init) => {
      if (!init) return false;
      if (init.type === 'ArrowFunctionExpression' && init.body.type !== 'BlockStatement') return fromDrizzle(context, init.body);
      return init.type === 'CallExpression' && fromDrizzle(context, init);
    };
    const exportOk = (n) => {
      const d = n.declaration;
      if (!d && n.specifiers.length === 0) return true; // `export {}` hands nothing on
      if (n.exportKind === 'type' || d?.type === 'TSTypeAliasDeclaration' || d?.type === 'TSInterfaceDeclaration') return true;
      if (d?.type === 'FunctionDeclaration') return Boolean(o.helper) && d.id?.name === o.helper;
      return d?.type === 'VariableDeclaration' && d.kind === 'const' && d.declarations.every((v) => isDeclaration(v.init));
    };
    return {
      Identifier(n) {
        if (n.name === 'sql' && !isDataKey(n) && !allowed(n)) report(n, 'No sql outside its positions in the SQL zone');
      },
      'MemberExpression[computed=true]'(n) {
        if (staticString(n.property) === 'sql') report(n, 'No sql through a computed member');
      },
      'Property[computed=true]'(n) {
        if (staticString(n.key) === 'sql') report(n, 'No sql through a computed key');
      },
      ImportExpression(n) {
        if (o.importExpressions) report(n, 'No import() expressions');
      },
      ImportDeclaration(n) {
        const src = n.source.value;
        if (n.importKind === 'type' || !DRIZZLE.test(src) || src === 'drizzle-orm/pg-core') return;
        for (const s of n.specifiers) {
          if (s.type !== 'ImportSpecifier') report(s, 'Import drizzle-orm helpers by name, from the allowlist');
          else if (s.importKind === 'type') continue;
          else if (s.imported.name === 'sql' && s.local.name !== 'sql') report(s, 'Import sql under its own name');
          else if (!o.allowNames.includes(s.imported.name)) report(s, `${s.imported.name} is not on the drizzle-orm allowlist`);
        }
      },
      ExportNamedDeclaration(n) {
        if (o.zone && !exportOk(n)) report(n, 'A zone file exports only table, view and column declarations');
      },
      'ExportAllDeclaration, ExportDefaultDeclaration'(n) {
        if (o.zone) report(n, 'A zone file exports only table, view and column declarations');
      },
    };
  },
};

/**
 * D7's re-export guard (ADR-001 §5): a library file may not hand on what `@radcore/db/*` or lib-platform's `db/`
 * gives it, by `export ... from`, by exporting an imported binding, or by aliasing one in an exported const.
 * Options: { sources: [regex], message }.
 */
const noDbReexport = {
  meta: { type: 'problem', docs: { description: 'ADR-001 D7: no re-export of tables or transactions' }, schema: false,
    messages: { m: '{{message}}' } },
  create(context) {
    const { sources, message } = context.options[0];
    const res = sources.map((s) => new RegExp(s));
    const hit = (src) => typeof src === 'string' && res.some((re) => re.test(src));
    const report = (node) => context.report({ node, messageId: 'm', data: { message } });
    const importedHere = (id) => id?.type === 'Identifier' && hit(importSource(context, id));
    return {
      'ExportNamedDeclaration[source], ExportAllDeclaration'(n) {
        if (hit(n.source.value)) report(n);
      },
      'ExportNamedDeclaration:not([source])'(n) {
        for (const s of n.specifiers) if (importedHere(s.local)) report(s);
        for (const v of n.declaration?.declarations ?? []) if (v.init && importedHere(chainRoot(v.init))) report(v);
      },
      ExportDefaultDeclaration(n) {
        if (importedHere(chainRoot(n.declaration))) report(n);
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
    'd7-no-db-reexport': noDbReexport,
    'no-sql': noSql,
    'no-query-strings': restrict('ADR-002 L2: no query strings'),
    'no-raw-execution': restrict('ADR-002 L3: no raw execution'),
    'no-driver': restrict('ADR-002 L4: no driver outside the pool'),
    'no-raw-html': restrict('ADR-002 L6: no raw HTML'),
    'outbound-only': restrict('ADR-002 L8: outside calls go through the guarded client'),
    'tables-in-schema': restrict('ADR-002 L9a: tables are declared only in the schema'),
    'views-in-views': restrict('ADR-002 L9b: views are declared only in views'),
    // Guards for the rules above: a `#` alias or a `declare` would hide an import or a global from them.
    'no-subpath-imports': restrict('No package.json "imports" aliases, which hide the real specifier'),
    'no-declare': restrict('No ambient declarations outside .d.ts, which hide globals'),
  },
};
