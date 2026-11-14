// The local ESLint plugin for ADR-001's E-rules and ADR-002's L-rules. Each ADR rule is its own rule here, so a later
// config block can never replace another rule's options (ADR-001 "One ESLint rule per E-rule"). Selectors and
// patterns live in eslint.config.mjs as each rule's options; tools/eslint-options.json pins them.
import ts from 'typescript';

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
// A reference that exists only for the type checker: typescript-eslint marks it, or it sits inside `typeof` in a type.
const isTypeOnly = (ref) => {
  if (ref.isValueReference === false) return true;
  for (let p = ref.identifier.parent; p; p = p.parent) if (p.type === 'TSTypeQuery') return true;
  return false;
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
 *   globalMembers: { objects, members, message }           the real global objects, readable only as `G.key` for a
 *                                                          static key not in members (L8)
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
    const gm = o.globalMembers;
    if (globals.size || gm) {
      on('Program:exit', (program) => {
        const scope = context.sourceCode.getScope(program);
        // References that resolve to no declaration in the file: the real globals.
        const refs = [...scope.through, ...scope.variables.filter((v) => v.defs.length === 0).flatMap((v) => v.references)];
        for (const ref of refs) {
          const id = ref.identifier;
          // A type-only use (`type Fetch = typeof fetch`) runs nothing.
          if (isTypeOnly(ref)) continue;
          const message = globals.get(id.name);
          if (message) report(id, message);
          if (gm?.objects.includes(id.name)) checkGlobalObject(id);
        }
      });
    }
    // The real global object (resolved by scope, so a local `deps` or `ctx.outbound` never counts) may only be read
    // as `G.key` with a static key that isn't one of `members`, such as `globalThis.structuredClone`. Any other use
    // (passing it on, returning it, aliasing, destructuring, spreading, a dynamic key) could reach a member.
    const WRAPPERS = new Set(['ChainExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion']);
    const checkGlobalObject = (id) => {
      let n = id;
      while (WRAPPERS.has(n.parent.type) && n.parent.expression === n) n = n.parent;
      const p = n.parent;
      const key = p.type === 'MemberExpression' && p.object === n ? (p.computed ? staticString(p.property) : p.property.name) : null;
      // A key that is itself a global object (`globalThis.globalThis`, `self.window`) leads back to the same object.
      if (key === null || gm.members.includes(key) || gm.objects.includes(key)) report(id, gm.message);
    };
    return listeners;
  },
});

/**
 * L1, no `sql` outside its positions (ADR-002 §3). Options:
 *   allowNames: the value imports allowed from drizzle-orm and its subpaths other than pg-core (on everywhere)
 *   zone: in the SQL zone files. A `sql` tag may then be the direct argument of a drizzle `check()`, a drizzle
 *         column's `.default()` or `.generatedAlwaysAs()`, or `pgView(...).as()` (in a views file also
 *         `radcore.view(...).as()`, on the schema imported from exactly '../src/columns.ts'), and the file may export only
 *         drizzle declarations (tables, views, columns), so no zone file can hand out an SQL value of its own
 *   helper: in request-context.ts, the one function whose body may use `sql`
 *   exportedFunctions: in log-writers.ts, each exported function's body may use `sql`, and the file may export them
 *   importExpressions: false in test files, which may use import() for mocking
 */
const noSql = {
  meta: { type: 'problem', docs: { description: 'ADR-002 L1' }, schema: false, messages: { m: '{{message}}' } },
  create(context) {
    const o = { importExpressions: true, ...context.options[0] };
    const report = (node, message) => context.report({ node, messageId: 'm', data: { message: `[L1] ${message} (ADR-002).` } });
    const inViews = /[\\/]views[\\/][^\\/]+$/.test(context.filename);
    const allowedCall = (call) => {
      const c = call.callee;
      if (c.type === 'Identifier') return c.name === 'check' && fromDrizzle(context, c);
      if (c.type !== 'MemberExpression' || c.computed) return false;
      if (['default', 'generatedAlwaysAs'].includes(c.property.name)) return fromDrizzle(context, c.object);
      // `pgView(...).as()`, also through options such as `.with({ securityInvoker: true })` or `.withNoData()`.
      const root = c.property.name === 'as' && c.object.type === 'CallExpression' ? chainRoot(c.object) : null;
      if (!root) return false;
      if (['pgView', 'pgMaterializedView'].includes(root.name)) return fromDrizzle(context, root);
      // `radcore.view(...).as()`: a view in the schema columns.ts declares (ADR-005 §7c), and only in a views file.
      // Exactly the real file's named `radcore` export. A views file sits directly in packages/db/views, so this
      // specifier can only be packages/db/src/columns.ts. Any other `columns.ts`, or a namespace import's `view`,
      // could be a look-alike that hands the `sql` back.
      const m = root.parent;
      const d = findVariable(context.sourceCode.getScope(root), root.name)?.defs[0];
      const named = d?.type === 'ImportBinding' && d.node.type === 'ImportSpecifier'
        && (d.node.imported.name ?? d.node.imported.value) === 'radcore';
      return inViews && named && m.type === 'MemberExpression' && m.object === root && !m.computed
        && ['view', 'materializedView'].includes(m.property.name) && m.parent.type === 'CallExpression'
        && m.parent.callee === m && ['../src/columns.ts', '../src/columns'].includes(importSource(context, root) ?? '');
    };
    const inHelper = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (p.type !== 'FunctionDeclaration') continue;
        if (p.id?.name === o.helper || (o.exportedFunctions && p.parent.type === 'ExportNamedDeclaration')) return true;
      }
      return false;
    };
    // Inside the zone: only as the tag of a template that is the direct argument of an allowed call (so no
    // `sql.raw` or nested `sql` inside it), or anywhere in the one helper.
    const allowed = (node) => {
      if (!o.zone) return false;
      if (node.parent.type === 'ImportSpecifier') return node.parent.imported.name === node.parent.local.name;
      if ((o.helper || o.exportedFunctions) && inHelper(node)) return true;
      const tt = node.parent;
      if (tt.type !== 'TaggedTemplateExpression' || tt.tag !== node) return false;
      // `sql\`... ${n}\`.inlineParams()` renders a number into DDL as a literal, not a `$1` bind parameter (a CHECK's
      // cap or length); it then stands where the bare template would.
      const p = tt.parent;
      const arg = p.type === 'MemberExpression' && p.object === tt && !p.computed && p.property.name === 'inlineParams'
        && p.parent.type === 'CallExpression' && p.parent.callee === p && p.parent.arguments.length === 0 ? p.parent : tt;
      return arg.parent.type === 'CallExpression' && arg.parent.arguments.includes(arg) && allowedCall(arg.parent);
    };
    const isDataKey = (n) => n.parent.type === 'Property' && n.parent.key === n && !n.parent.computed
      && !n.parent.shorthand && n.parent.parent.type === 'ObjectExpression';

    // What a zone file may export: a drizzle declaration (a table, schema table, creator table, view or column, but
    // never a `check`), an object of them (audit columns), or a function that returns one.
    // A relative import counts only from another zone file (whose own exports this rule already limits).
    const fromZoneFile = (id) => {
      const src = importSource(context, id) ?? '';
      if (!/^\.\.?\//.test(src)) return false;
      return /(^|\/)(tables|columns)(\.ts)?$/.test(src) || (inViews && /^\.\/(?!index(\.ts)?$)[^/]+$/.test(src));
    };
    const def = (id) => findVariable(context.sourceCode.getScope(id), id.name)?.defs[0];
    const localInit = (id) => {
      const d = def(id);
      return d?.type === 'Variable' && d.parent.kind === 'const' ? d.node.init : null;
    };
    const isValue = (n, depth = 0) => {
      if (!n || depth > 10) return false; // a bound on the walk; real schema code nests a handful of levels
      switch (n.type) {
        case 'ObjectExpression':
          return n.properties.every((p) => (p.type === 'SpreadElement' ? isValue(p.argument, depth + 1)
            : !p.computed && isValue(p.value, depth + 1)));
        case 'ArrowFunctionExpression': case 'FunctionExpression': case 'FunctionDeclaration':
          return returnsValue(n, depth + 1);
        // `satisfies` and `as const` change no value; the root is checked as before.
        case 'TSSatisfiesExpression': case 'TSAsExpression':
          return isValue(n.expression, depth + 1);
        // An enum-like tuple of string codes: `['draft', 'posted'] as const`.
        case 'ArrayExpression':
          return n.elements.length > 0 && n.elements.every((e) => e?.type === 'Literal' && typeof e.value === 'string');
        case 'Identifier': {
          const src = importSource(context, n);
          if (src) return fromZoneFile(n) || (DRIZZLE.test(src) && !['check', 'sql'].includes(n.name));
          // A helper's own parameter, as in `(cols) => ({ ...cols, ...audit })`: whatever the caller passes.
          if (def(n)?.type === 'Parameter') return true;
          return isValue(localInit(n), depth + 1);
        }
        case 'CallExpression': case 'MemberExpression': {
          const root = chainRoot(n);
          if (!root || root.name === 'check' || root.name === 'sql') return false;
          return isValue(root, depth + 1);
        }
        default:
          return false;
      }
    };
    const returnsValue = (fn, depth) => {
      if (fn.body.type !== 'BlockStatement') return isValue(fn.body, depth);
      const returns = [];
      const visit = (s) => {
        if (!s || typeof s !== 'object' || /Function/.test(s.type ?? '')) return;
        if (s.type === 'ReturnStatement') returns.push(s.argument);
        for (const [k, v] of Object.entries(s)) if (k !== 'parent') (Array.isArray(v) ? v : [v]).forEach(visit);
      };
      fn.body.body.forEach(visit);
      return returns.length > 0 && returns.every((r) => isValue(r, depth));
    };
    const exportOk = (n) => {
      const d = n.declaration;
      if (!d && n.specifiers.length === 0) return true; // `export {}` hands nothing on
      if (n.exportKind === 'type' || d?.type === 'TSTypeAliasDeclaration' || d?.type === 'TSInterfaceDeclaration') return true;
      if (d?.type === 'FunctionDeclaration') {
        return Boolean(o.exportedFunctions) || (Boolean(o.helper) && d.id?.name === o.helper) || returnsValue(d, 0);
      }
      return d?.type === 'VariableDeclaration' && d.kind === 'const' && d.declarations.every((v) => isValue(v.init));
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

/**
 * D7's export guard, with type information (ADR-001 §5): a library's entry (index.ts, contract.ts) may not export
 * anything whose type carries a table, view, column, raw database or module transaction, however it was wrapped:
 * a function returning `salesTx(ctx)`, an alias, a cast, or an object holding one.
 * Options: { names: [type names], txPattern: regex for module-transaction type names, message }.
 */
const noTableExports = {
  meta: { type: 'problem', docs: { description: 'ADR-001 D7: no table or transaction in a library entry' }, schema: false,
    messages: { m: '{{message}} ({{name}})' } },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program) return {};
    const checker = services.program.getTypeChecker();
    const { names, txPattern, message } = context.options[0];
    const tx = new RegExp(txPattern);
    // A bound on the walk, not on what is checked: an entry's types reach a table within a few hops
    // (Promise<SalesTx>, (fn: (tx: SalesTx) => T) => T, { tables: { invoices } }).
    const MAX_DEPTH = 8;
    const PROPERTY_DEPTH = 6;
    // Structure only: array and tuple elements, never a generic's type arguments. drizzle types a row as
    // `InferSelectModel<Table<T>>`, so following type arguments would find a table inside every plain row type.
    const elements = (type) => (checker.isArrayType(type) || checker.isTupleType(type) ? checker.getTypeArguments(type) : []);
    // A table or transaction type is declared in drizzle-orm or in our own packages/db, so the walk enters other
    // packages' types only through their type arguments: a zod schema's methods return more zod types, and walking
    // them ran ESLint out of memory on every entry that exports a schema (M1-04). TypeScript's own lib is walked in
    // full, for Promise<SalesTx>.
    const FOREIGN = /[\\/]node_modules[\\/](?!drizzle-orm[\\/]|typescript[\\/]lib[\\/])/;
    const foreign = (sym) => (sym?.declarations?.length ?? 0) > 0
      && sym.declarations.every((d) => FOREIGN.test(d.getSourceFile().fileName));
    const carries = (type, best, depth) => {
      if (!type || depth > MAX_DEPTH) return false;
      // Keep the shallowest depth a type was reached at, so a deeper first visit can't hide a shallower one.
      const seen = best.get(type);
      if (seen !== undefined && seen <= depth) return false;
      best.set(type, depth);
      for (const sym of [type.getSymbol(), type.aliasSymbol]) {
        const name = sym?.getName();
        if (name && (names.includes(name) || tx.test(name))) return true;
      }
      // Into another package's type, only through what we passed it: AsyncLocalStorage<SalesTx> holds a transaction.
      if (foreign(type.aliasSymbol ?? type.getSymbol())) {
        const args = [...(type.aliasTypeArguments ?? []), ...(type.target ? checker.getTypeArguments(type) : [])];
        return args.some((t) => carries(t, best, depth + 1));
      }
      const awaited = checker.getAwaitedType(type);
      const next = [
        ...(type.isUnionOrIntersection() ? type.types : []),
        ...elements(type),
        ...(awaited && awaited !== type ? [awaited] : []),
        ...[...type.getCallSignatures(), ...type.getConstructSignatures()].flatMap((s) =>
          [s.getReturnType(), ...s.getParameters().map((p) => checker.getTypeOfSymbol(p))]),
        ...checker.getIndexInfosOfType(type).map((i) => i.type),
        ...(depth < PROPERTY_DEPTH ? type.getProperties().map((p) => checker.getTypeOfSymbol(p)) : []),
      ];
      return next.some((t) => carries(t, best, depth + 1));
    };
    return {
      'Program:exit'(program) {
        const file = services.esTreeNodeToTSNodeMap.get(program);
        const moduleSymbol = checker.getSymbolAtLocation(file);
        if (!moduleSymbol) return;
        for (const exported of checker.getExportsOfModule(moduleSymbol)) {
          let s = exported;
          try { s = checker.getAliasedSymbol(exported); } catch { /* not an alias */ }
          const types = [s.valueDeclaration ? checker.getTypeOfSymbol(s) : null, checker.getDeclaredTypeOfSymbol(s)];
          if (types.some((t) => carries(t, new Map(), 0))) {
            context.report({ node: program, messageId: 'm', data: { message, name: exported.getName() } });
          }
        }
      },
    };
  },
};

// E7 (RAD-85, ADR-001 §6a): a module service reading a table that holds some key's records (the catalogue's
// `records`; options.tables, '<source>#<export>') applies the record scope in the same function, the outermost one
// around the read: `x.see(...)`, `x.can(...)` or lib-platform's `listScope(...)`. A read is the table as an argument of
// `.from` or a join, imported by name (aliased or not) or through a namespace, or `.query.<table>`. It can't follow a
// read or a check into another function, a table passed around as a value, a table reached through a relation
// (`with:`) or a view, or whether the check names the right owner.
const READS = new Set(['from', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin', 'crossJoin']);
const CHECKS = new Set(['see', 'can']);
const scopeOnOwnedReads = {
  meta: { type: 'problem', docs: { description: 'ADR-001 E7: a scoped read applies the record scope' }, schema: false,
    messages: { m: '[E7] {{table}} holds records a role may see only its own of: apply ctx.see, ctx.can or listScope in this function (ADR-001 §6a)' } },
  create(context) {
    const tables = new Set(context.options[0]?.tables ?? []);
    const names = new Set([...tables].map((t) => t.slice(t.lastIndexOf('#') + 1)));
    const outermost = (n) => {
      let f = null;
      for (let p = n.parent; p; p = p.parent) if (/Function/.test(p.type)) f = p;
      return f;
    };
    const bindingOf = (id) => findVariable(context.sourceCode.getScope(id), id.name)?.defs[0];
    // '<source>#<export>' for a table argument: `leads`, `leads as l`, or `crm.leads` through `import * as crm`.
    const tableOf = (a) => {
      if (a.type === 'Identifier') {
        const d = bindingOf(a);
        if (d?.type !== 'ImportBinding' || d.node.type !== 'ImportSpecifier') return null;
        return `${d.parent.source.value}#${d.node.imported.name ?? d.node.imported.value}`;
      }
      if (a.type === 'MemberExpression' && !a.computed && a.object.type === 'Identifier') {
        const d = bindingOf(a.object);
        return d?.type === 'ImportBinding' && d.node.type === 'ImportNamespaceSpecifier' ? `${d.parent.source.value}#${a.property.name}` : null;
      }
      return null;
    };
    const reads = [];
    const checked = new Set();
    return {
      CallExpression(n) {
        const c = n.callee;
        if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
          if (CHECKS.has(c.property.name)) checked.add(outermost(n));
          if (READS.has(c.property.name)) {
            for (const a of n.arguments) {
              const t = tableOf(a);
              if (t !== null && tables.has(t)) reads.push({ node: a, table: t, fn: outermost(n) });
            }
          }
        }
        if (c.type === 'Identifier' && c.name === 'listScope' && importSource(context, c) === '@radcore/lib-platform') checked.add(outermost(n));
      },
      // The relational API names the table by its key only: `tx.query.leads.findMany()`.
      MemberExpression(n) {
        if (!n.computed && n.property.type === 'Identifier' && names.has(n.property.name) && n.object.type === 'MemberExpression'
          && !n.object.computed && n.object.property.type === 'Identifier' && n.object.property.name === 'query') {
          reads.push({ node: n.property, table: n.property.name, fn: outermost(n) });
        }
      },
      'Program:exit'() {
        for (const r of reads) if (!checked.has(r.fn)) context.report({ node: r.node, messageId: 'm', data: { table: r.table } });
      },
    };
  },
};

// E6 by type (RAD-67): a value whose type carries one of lib-common's decimal brands (Money, Rate, Quantity, Percent),
// or is a decimal.js Decimal, never meets +, -, *, /, %, **, <, <=, >, >=, Number(), parseFloat, Math or a unary sign,
// whatever it's named; two of them never meet ===. A string brand would concatenate or compare as text, and a Decimal
// would turn into its string on the way. The name list (e6-no-float-money) still covers values with no brand.
const brandedMoney = {
  meta: { type: 'problem', docs: { description: 'ADR-001 E6: no number maths or comparison on a branded decimal' },
    schema: false, messages: { m: '{{message}} (a {{kind}})' } },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program) return {};
    const checker = services.program.getTypeChecker();
    const { brands, classes, message } = context.options[0];
    const BRAND_KEY = /^__@\$brand@/;
    // The brand or class a type carries, through unions and intersections: `Money | null`, `string & $brand<'Money'>`.
    const kindOf = (type, depth = 0) => {
      if (depth > 4) return null;
      if (type.isUnion() || type.isIntersection()) {
        for (const t of type.types) { const k = kindOf(t, depth + 1); if (k) return k; }
        return null;
      }
      const name = type.getSymbol()?.getName();
      if (name !== undefined && classes.includes(name)) return name;
      for (const p of type.getProperties()) {
        if (!BRAND_KEY.test(p.getName())) continue;
        const kind = checker.getTypeOfSymbol(p).getProperties().map((q) => q.getName()).find((n) => brands.includes(n));
        if (kind) return kind;
      }
      return null;
    };
    const typeOf = (node) => checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
    const kind = (node) => kindOf(typeOf(node));
    // The brand an array or tuple holds (`Money[]`, `readonly Rate[]`, `[Money, Money]`), for a spread or a callback
    // (the auditor on #159): `Math.max(...amounts)`, `amounts.map(Number)`.
    const elementKindOf = (type, depth = 0) => {
      if (depth > 4) return null;
      for (const t of type.isUnion() ? type.types : [type]) {
        if (!checker.isArrayType(t) && !checker.isTupleType(t)) continue;
        for (const e of checker.getTypeArguments(t)) {
          const k = kindOf(e) ?? elementKindOf(e, depth + 1);
          if (k) return k;
        }
      }
      return null;
    };
    const report = (node, k) => {
      if (k) context.report({ node, messageId: 'm', data: { message, kind: k } });
      return Boolean(k);
    };
    const check = (node, operand = node) => report(node, operand && kind(operand));
    const MATHS = new Set(['+', '-', '*', '/', '%', '**', '<', '<=', '>', '>=']);
    const COMPOUND = new Set(['+=', '-=', '*=', '/=', '%=', '**=']);
    const isConversion = (c) => (c.type === 'Identifier' && (c.name === 'Number' || c.name === 'parseFloat' || c.name === 'parseInt'))
      || (c.type === 'MemberExpression' && c.object.type === 'Identifier'
        && (c.object.name === 'Math' || (c.object.name === 'Number' && c.property.type === 'Identifier'
          && /^parse(Float|Int)$/.test(c.property.name))));
    // A `+` joining a branded value to plain text (`'Due: ' + roundMoney(x)`) is a label, as the name rule allows.
    const plainText = (n) => !kind(n)
      && (checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(n)).flags & ts.TypeFlags.StringLike) !== 0;
    return {
      BinaryExpression(node) {
        if (node.operator === '+') {
          if (!plainText(node.right) && check(node, node.left)) return;
          if (!plainText(node.left)) check(node, node.right);
        } else if (MATHS.has(node.operator)) {
          if (!check(node, node.left)) check(node, node.right);
        } else if (/^[!=]==?$/.test(node.operator) && kind(node.left) && kind(node.right)) {
          check(node, node.left);
        }
      },
      AssignmentExpression(node) {
        if (COMPOUND.has(node.operator) && !check(node, node.left)) check(node, node.right);
      },
      UpdateExpression(node) { check(node, node.argument); },
      UnaryExpression(node) { if (node.operator === '+' || node.operator === '-') check(node, node.argument); },
      CallExpression(node) {
        if (isConversion(node.callee)) {
          for (const a of node.arguments) {
            if (report(node, a.type === 'SpreadElement' ? elementKindOf(typeOf(a.argument)) ?? kind(a.argument) : kind(a))) return;
          }
          return;
        }
        // A conversion handed to a call on a branded array: amounts.map(Number), rates.reduce(Math.max).
        if (node.callee.type === 'MemberExpression' && node.arguments.some(isConversion)) {
          report(node, elementKindOf(typeOf(node.callee.object)));
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
    'd7-no-db-reexport': noDbReexport,
    'd7-no-table-exports': noTableExports,
    'e7-scope-on-owned-reads': scopeOnOwnedReads,
    'no-sql': noSql,
    'no-query-strings': restrict('ADR-002 L2: no query strings'),
    'no-raw-execution': restrict('ADR-002 L3: no raw execution'),
    'no-driver': restrict('ADR-002 L4: no driver outside the pool'),
    'no-raw-html': restrict('ADR-002 L6: no raw HTML'),
    'e6-no-float-money': restrict('ADR-001 E6: no floating-point maths or text comparison on money'),
    'e6-branded-money': brandedMoney,
    'outbound-only': restrict('ADR-002 L8: outside calls go through the guarded client'),
    'tables-in-schema': restrict('ADR-002 L9a: tables are declared only in the schema'),
    'views-in-views': restrict('ADR-002 L9b: views are declared only in views'),
    // Guards for the rules above: a `#` alias or a `declare` would hide an import or a global from them.
    'no-subpath-imports': restrict('No package.json "imports" aliases, which hide the real specifier'),
    'no-declare': restrict('No ambient declarations outside .d.ts, which hide globals'),
  },
};
