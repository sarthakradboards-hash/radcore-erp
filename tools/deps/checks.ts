// ADR-003's CI checks C2 to C9, as pure functions over a project's files. Each returns its problems, every one
// prefixed with its check, so a fixture can tell which clause fired. C1 is knip and C10 is `npm audit signatures`,
// both run as commands (tools/deps/cli.ts, .github/workflows/ci.yml).

export type LockEntry = {
  name?: string; version?: string; resolved?: string; integrity?: string; license?: string;
  dev?: boolean; link?: boolean; inBundle?: boolean; hasInstallScript?: boolean;
};
export type Lock = { lockfileVersion?: number; packages: Record<string, LockEntry> };
export type Manifest = { path: string; json: Record<string, unknown> };
export type Project = {
  manifests: Manifest[]; // the root package.json first
  lock: Lock;
  nvmrc: string;
  npmrc: string;
  dockerfiles: { path: string; text: string }[];
  installScripts: Record<string, { rebuild: boolean; reason: string }>;
  adr: string; // docs/architecture/adr/003-libraries.md
};

// semver.org's own pattern for a version: an exact `x.y.z[-pre][+build]`, nothing else.
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const isExact = (v: unknown): v is string => typeof v === 'string' && EXACT.test(v);
const major = (v: string) => Number(v.split('.')[0]);
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const deps = (m: Manifest, field: string) => (m.json[field] ?? {}) as Record<string, unknown>;
// The package a lockfile key names: `node_modules/a/node_modules/@b/c` is `@b/c`.
export const entryName = (key: string, e: LockEntry) => e.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
const entries = (lock: Lock) => Object.entries(lock.packages).filter(([key, e]) => key !== '' && !e.link && key.includes('node_modules/'));

/** C2: the Node version in .nvmrc is the one in every `engines`, `.npmrc`, every Docker base image and the CI runner. */
export function checkNode(p: Project, running?: string): string[] {
  const v = p.nvmrc.trim();
  const out: string[] = [];
  if (!isExact(v)) return [`[C2] .nvmrc holds "${v}", not an exact version`];
  const want = `>=${v} <${major(v) + 1}`;
  for (const m of p.manifests) {
    const got = (m.json['engines'] as { node?: string } | undefined)?.node;
    if (got !== want) out.push(`[C2] ${m.path} engines.node is ${JSON.stringify(got)}, not "${want}"`);
  }
  if (!/^engine-strict\s*=\s*true\s*$/m.test(p.npmrc)) out.push('[C2] .npmrc does not set engine-strict=true');
  for (const d of p.dockerfiles) {
    for (const [, tag] of d.text.matchAll(/^\s*FROM\s+(?:--\S+\s+)*node:(\S+)/gim)) {
      if (!tag?.startsWith(`${v}-`) && tag !== v && !tag?.startsWith(`${v}@`)) out.push(`[C2] ${d.path} uses node:${tag}, not ${v}`);
    }
  }
  if (running !== undefined && running !== `v${v}`) out.push(`[C2] the runner's node is ${running}, not v${v}`);
  return out;
}

/** C3: every dependency and override is an exact version; `@radcore/*` only as "*" linked to its workspace. */
export function checkPins(p: Project): string[] {
  const out: string[] = [];
  // `name` is the top-level key; nested `overrides` objects keep it and extend the path.
  const walk = (m: Manifest, name: string, value: unknown, path: string) => {
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(m, name, v, `${path} > ${k}`);
      return;
    }
    if (name.startsWith('@radcore/')) {
      if (value !== '*' || p.lock.packages[`node_modules/${name}`]?.link !== true) {
        out.push(`[C3] ${m.path} ${path}: ${JSON.stringify(value)} must be "*" and linked to the workspace`);
      }
    } else if (!isExact(value)) {
      out.push(`[C3] ${m.path} ${path}: ${JSON.stringify(value)} is not an exact version`);
    }
  };
  for (const m of p.manifests) {
    for (const field of [...DEP_FIELDS, 'overrides']) for (const [k, v] of Object.entries(deps(m, field))) walk(m, k, v, `${field}.${k}`);
  }
  return out;
}

const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0']);
const isExpression = (l: string) => /\b(AND|OR|WITH)\b|[()]/.test(l);
const spdxIds = (l: string) => l.split(/\s+(?:AND|OR|WITH)\s+|[()]/).map((s) => s.trim()).filter(Boolean);
const glob = (pattern: string) => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`);

/** The rows of a Markdown table whose header row starts with `header` (cells, trimmed). */
function tableRows(markdown: string, header: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  const rows: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]?.trim().startsWith(header)) continue;
    for (let j = i + 2; j < lines.length && lines[j]?.trim().startsWith('|'); j++) {
      rows.push((lines[j] ?? '').trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim()));
    }
  }
  return rows;
}

/** C4: every lockfile package's licence is on ADR-003 §4's list, MPL-2.0 only for dev packages, or a named exception. */
export function checkLicences(p: Project): string[] {
  const exceptions = tableRows(p.adr, '| Package | Licence |').map(([pkg = '', licence = '']) => ({
    names: [...pkg.matchAll(/`([^`]+)`/g)].map((m) => glob(m[1] ?? '')),
    licence,
  }));
  const out: string[] = [];
  for (const [key, e] of entries(p.lock)) {
    const name = entryName(key, e);
    const l = e.license;
    if (l && !isExpression(l) && (ALLOWED.has(l) || (l === 'MPL-2.0' && e.dev === true))) continue;
    const excepted = exceptions.some((x) => x.names.some((re) => re.test(name))
      && l !== undefined && spdxIds(l).every((id) => x.licence.includes(id)));
    if (excepted) continue;
    if (!l) out.push(`[C4] ${name}@${e.version} has no licence`);
    else if (l === 'MPL-2.0') out.push(`[C4] ${name}@${e.version} is MPL-2.0 in production`);
    else if (isExpression(l)) out.push(`[C4] ${name}@${e.version} has the expression "${l}" and no exception row`);
    else out.push(`[C4] ${name}@${e.version} is ${l}, not an allowed licence`);
  }
  return out;
}

type AuditReport = { vulnerabilities?: Record<string, { severity: string; nodes?: string[] }> };
/** C5: from `npm audit --json`: high or worse anywhere, or moderate or worse in a production package. */
export function checkAudit(report: AuditReport, lock: Lock): string[] {
  const out: string[] = [];
  for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
    const prod = (v.nodes ?? []).some((n) => lock.packages[n]?.dev !== true);
    if (['high', 'critical'].includes(v.severity) || (v.severity === 'moderate' && prod)) {
      out.push(`[C5] ${name}: ${v.severity} advisory${prod ? ' in a production package' : ''}`);
    }
  }
  return out;
}

/** The approved list from ADR-003 §2: package name to its exact version. */
export function approvedList(adr: string): Map<string, string> {
  const section = adr.slice(adr.indexOf('### 2.'), adr.indexOf('### 3.'));
  const list = new Map<string, string>();
  for (const [, lib = '', version = ''] of tableRows(section, '| Need | Library |')) {
    const strip = (s: string) => s.replace(/\*\*/g, '').replace(/\([^)]*\)/g, '').replace(/`/g, '');
    const names = strip(lib).split(',').map((s) => s.trim()).filter((s) => /^(@[a-z0-9.-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(s));
    const versions = strip(version).split(',').map((s) => s.trim()).filter(isExact);
    // One version per name, or one version shared by every name (`react, react-dom | 19.3.1`).
    if (names.length === versions.length) names.forEach((n, i) => list.set(n, versions[i] ?? ''));
    else if (versions.length === 1) names.forEach((n) => list.set(n, versions[0] ?? ''));
  }
  return list;
}

/** C6: every direct dependency has its row in ADR-003 §2 at the same version; an `@types/*` major matches its package. */
export function checkList(p: Project): string[] {
  const list = approvedList(p.adr);
  const declared = new Map<string, string>();
  for (const m of p.manifests) for (const f of DEP_FIELDS) for (const [n, v] of Object.entries(deps(m, f))) declared.set(n, String(v));
  const out: string[] = [];
  for (const m of p.manifests) {
    for (const f of DEP_FIELDS) {
      for (const [name, raw] of Object.entries(deps(m, f))) {
        const version = String(raw);
        if (name.startsWith('@radcore/')) continue;
        if (name.startsWith('@types/')) {
          const typed = name.slice('@types/'.length).replace(/^(.+)__(.+)$/, '@$1/$2');
          const base = typed === 'node' ? p.nvmrc.trim() : declared.get(typed);
          if (base === undefined) out.push(`[C6] ${m.path} ${name} types ${typed}, which no workspace declares`);
          else if (major(version) !== major(base)) out.push(`[C6] ${m.path} ${name}@${version} is not major ${major(base)} like ${typed}`);
          continue;
        }
        const row = list.get(name);
        if (row === undefined) out.push(`[C6] ${m.path} ${name} has no row in ADR-003 §2`);
        else if (row !== version) out.push(`[C6] ${m.path} ${name}@${version} differs from ADR-003 §2's ${row}`);
      }
    }
  }
  return out;
}

/** C7: every lockfile package with an install script is on tools/install-scripts.json. */
export function checkInstallScripts(p: Project): string[] {
  return entries(p.lock).filter(([, e]) => e.hasInstallScript).map(([key, e]) => entryName(key, e))
    .filter((name) => !(name in p.installScripts)).map((name) => `[C7] ${name} has an install script not listed in tools/install-scripts.json`);
}

/** C8: lockfile version 3, every package resolved on npm's registry with a sha512 integrity. */
export function checkLockfile(lock: Lock): string[] {
  const out: string[] = [];
  if (lock.lockfileVersion !== 3) out.push(`[C8] lockfileVersion is ${lock.lockfileVersion}, not 3`);
  for (const [key, e] of entries(lock)) {
    if (e.inBundle) continue;
    const name = entryName(key, e);
    if (!e.resolved?.startsWith('https://registry.npmjs.org/')) out.push(`[C8] ${name} resolves to ${e.resolved}, off the registry`);
    if (!e.integrity?.startsWith('sha512-')) out.push(`[C8] ${name} has integrity ${e.integrity?.split('-')[0]}, not sha512`);
  }
  return out;
}

export type AgeException = { name: string; version: string };
const DAY = 24 * 60 * 60 * 1000;
/** The name@version pairs in `head` that `base` doesn't have. */
export function changedEntries(head: Lock, base: Lock | null): string[] {
  const ids = (l: Lock) => new Set(entries(l).map(([k, e]) => `${entryName(k, e)}@${e.version}`));
  const before = base ? ids(base) : new Set<string>();
  return [...ids(head)].filter((id) => !before.has(id));
}
/** C9: each package version added or changed is at least 14 days old, unless ADR-003 §5 names it. */
export function checkAge(changed: string[], published: Record<string, string | undefined>, now: number, exceptions: AgeException[]): string[] {
  const out: string[] = [];
  for (const id of changed) {
    const at = id.lastIndexOf('@');
    const name = id.slice(0, at);
    const version = id.slice(at + 1);
    if (exceptions.some((x) => glob(x.name).test(name) && x.version === version)) continue;
    const t = published[id];
    if (!t) out.push(`[C9] ${id}: no publish time from the registry`);
    else if (now - Date.parse(t) < 14 * DAY) out.push(`[C9] ${id} was published ${t}, less than 14 days ago`);
  }
  return out;
}
