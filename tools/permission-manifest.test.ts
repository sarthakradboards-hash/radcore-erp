// RAD-37 (M1-19, RC-153): every route and job the api and worker actually mount, against the hand-written manifest
// (tools/permission-manifest.ts). The two sides are built separately, so deleting a route's check, changing it, or
// adding a route without its line fails here: the sweep never reads the table from the code it checks. Each key a
// route or job checks must also be one the permission matrix can grant (RAD-36's catalogue).
import { loadConfig, type JobDefinition, type Route } from '@radcore/lib-platform';
import { createAuth } from '@radcore/lib-platform/runtime';
import { createClientErrors } from '@radcore/lib-platform';
import { piiPlan, type PiiPlan } from '@radcore/lib-common';
import { testSettings } from '@radcore/test-helpers';
import { describe, expect, it } from 'vitest';
import { createEnquiryForm } from '@radcore/lib-crm';
import { apiRoutes } from '../apps/api/src/routes.ts';
import webhooks from '../apps/api/src/routes/hooks.ts';
import { workerJobs } from '../apps/worker/src/worker-jobs.ts';
import { PERMISSIONS, type Permission } from '../packages/lib-platform/src/permissions.ts';
import { JOB_PRINCIPALS, ROUTE_CHECKS } from './permission-manifest.ts';

/** What a route checks, in the manifest's words: its key; `public`, with any key it also names, which shouldn't be
 * there; or `link <action>`, the one action a public link may take (RAD-41). */
function checkOf(r: Pick<Route, 'contract'>): string {
  const c = r.contract;
  if (c.auth === 'public') return c.perm === null ? 'public' : `public ${c.perm}`;
  if (c.auth === 'link') return `link ${c.action}`;
  if (c.auth === 'webhook') return 'webhook';
  return c.perm;
}
/** What a job runs as, in the manifest's words. */
const principalOf = (j: JobDefinition): string => (j.principal.kind === 'system'
  ? `system ${j.principal.name} [${j.principal.permissions.join(', ')}]`
  : `user ${typeof j.principal.perm === 'string' ? j.principal.perm : '<by input>'}`);

/** Every disagreement between what's mounted and the table: missing lines, lines for nothing, and changed checks. */
function disagreements(mounted: Readonly<Record<string, string>>, table: Readonly<Record<string, string>>): string[] {
  return [
    ...Object.keys(mounted).filter((k) => !(k in table)).map((k) => `${k}: mounted, but not in the manifest`),
    ...Object.keys(table).filter((k) => !(k in mounted)).map((k) => `${k}: in the manifest, but nothing mounts it`),
    ...Object.keys(mounted).filter((k) => k in table && table[k] !== mounted[k])
      .map((k) => `${k}: checks ${mounted[k] ?? ''}, but the manifest says ${table[k] ?? ''}`),
  ];
}

/** Every key a record in an answer names as `seenWith`, anywhere in the answer. */
const seenWithKeys = (plan: PiiPlan | null): string[] => (plan === null || 'kind' in plan ? [] : 'each' in plan ? seenWithKeys(plan.each)
  : [...(plan.seenWith === undefined ? [] : [plan.seenWith]), ...Object.values(plan.fields).flatMap((f) => seenWithKeys(f))]);

/** A key that shows a record's personal fields must say so in the catalogue (`unmasks`, RAD-90) and be all-only, so
 * the matrix warns of it and an own-scope grant can't show every record's; and no key says so without unmasking one. */
function unmaskIssues(used: readonly string[], catalogue: readonly Permission[]): string[] {
  const seen = new Set(used);
  return [
    ...[...seen].filter((k) => !catalogue.some((p) => p.key === k && p.unmasks === true && p.allOnly === true))
      .map((k) => `${k}: a record is seen with it, but the catalogue doesn't mark it unmasks and all-only`),
    ...catalogue.filter((p) => p.unmasks === true && !seen.has(p.key)).map((p) => `${p.key}: marked unmasks, but no record is seen with it`),
  ];
}

describe('the permission manifest', () => {
  const cfg = loadConfig(testSettings(), 'api');
  // The api's own list, as main.ts mounts it; createAuth's store connects only when used.
  async function apiList(): Promise<readonly Route[]> {
    const log = { info: () => undefined, error: () => undefined };
    const auth = await createAuth(cfg, log);
    try {
      return apiRoutes(auth, createClientErrors(log), createEnquiryForm({ outbound: { request: () => Promise.reject(new Error('no network in this test')) }, secret: 'unused' }));
    } finally {
      await auth.store.stop();
    }
  }
  // The webhooks too (RAD-107): their own lane, mounted beside the routes.
  const mountedRoutes = async () => Object.fromEntries([...(await apiList()), ...webhooks]
    .map((r) => [`${r.contract.method} ${r.contract.path}`, checkOf(r)]));
  const mountedJobs = () => Object.fromEntries(workerJobs({ mailer: { send: async () => undefined }, publicOrigin: cfg.publicOrigin })
    .map((j) => [j.name, principalOf(j)]));

  it('matches every route the api mounts, line for line', async () => {
    const routes = await apiList();
    expect(routes.length).toBe(new Set(routes.map((r) => `${r.contract.method} ${r.contract.path}`)).size);
    expect(disagreements(await mountedRoutes(), ROUTE_CHECKS)).toEqual([]);
  });

  it('matches every job the worker runs, line for line', () => {
    expect(disagreements(mountedJobs(), JOB_PRINCIPALS)).toEqual([]);
  });

  it('names only keys the permission matrix can grant', () => {
    const catalogue = new Set(PERMISSIONS.map((p) => p.key));
    const checked = [...Object.values(ROUTE_CHECKS), ...Object.values(JOB_PRINCIPALS).flatMap((p) => p.split(/[ [\],]+/))]
      .filter((k) => /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(k));
    expect([...new Set(checked)].filter((k) => !catalogue.has(k))).toEqual([]);
  });

  // RC-153: the sweep must notice each way a check can go missing. Each case tampers with a copy of what's mounted.
  it.each([
    ['a route whose check was lowered', (m: Record<string, string>) => ({ ...m, 'PUT /admin/roles/:key/permissions': 'session:read' })],
    ['a route made public', (m: Record<string, string>) => ({ ...m, 'GET /admin/audit': 'public' })],
    ['a new route with no line', (m: Record<string, string>) => ({ ...m, 'POST /admin/backdoor': 'session:read' })],
    ['a route that was removed', (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'GET /me'))],
  ])('fails on %s', async (_, tamper) => {
    expect(disagreements(tamper(await mountedRoutes()), ROUTE_CHECKS)).toHaveLength(1);
  });

  it('marks every key a record is seen with as unmasks and all-only, and no other (RAD-90)', async () => {
    const used = (await apiList()).flatMap((r) => seenWithKeys(piiPlan(r.contract.output)));
    expect(used).toEqual(expect.arrayContaining(['parties:contact', 'leads:contact']));
    expect(unmaskIssues(used, PERMISSIONS)).toEqual([]);
    // A record seen with a key the catalogue doesn't mark is refused, and so is a mark nothing uses.
    expect(unmaskIssues([...used, 'session:read'], PERMISSIONS)).toEqual([
      "session:read: a record is seen with it, but the catalogue doesn't mark it unmasks and all-only"]);
    expect(unmaskIssues(used, PERMISSIONS.map((p) => (p.key === 'parties:contact' ? { ...p, allOnly: false } : p)))).toHaveLength(1);
    expect(unmaskIssues([], PERMISSIONS)).toEqual(['parties:contact: marked unmasks, but no record is seen with it',
      'leads:contact: marked unmasks, but no record is seen with it']);
  });

  it('names a link route by its action, and catches a public route that also names a key', () => {
    const route = (spec: Record<string, unknown>) => ({ contract: { method: 'POST', path: '/x', ...spec } }) as unknown as Route;
    expect([checkOf(route({ auth: 'link', action: 'sales.view_quote', perm: null })),
      checkOf(route({ auth: 'public', perm: 'users:write' })), checkOf(route({ auth: 'public', perm: null }))])
      .toEqual(['link sales.view_quote', 'public users:write', 'public']);
  });

  it('fails on a job whose principal gained keys or became a person', () => {
    expect(disagreements({ ...mountedJobs(), 'platform.outbox-cleanup': 'system outbox-cleanup [users:write]' }, JOB_PRINCIPALS))
      .toHaveLength(1);
    expect(disagreements({ ...mountedJobs(), 'platform.file-check': 'user photo_files:write' }, JOB_PRINCIPALS)).toHaveLength(1);
  });
});
