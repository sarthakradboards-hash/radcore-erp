// ADR-003's CI checks: the repo passes them, and every clause's fixture fails its own check.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approvedList, changedEntries, checkAge, checkAudit, checkInstallScripts, checkLicences, checkList, checkLockfile,
  checkNode, checkPins, type Project,
} from './deps/checks.ts';
import { AGE_EXCEPTIONS, loadProject } from './deps/project.ts';

const repo = loadProject('.');
const FIXTURES = 'tools/boundary-fixtures';
const CHECKS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'];
const fixtures = readdirSync(FIXTURES).filter((d) => /^C\d+-/.test(d));
type Options = { running?: string; now?: string; published?: Record<string, string> };
const options = (dir: string): Options =>
  existsSync(join(FIXTURES, dir, 'fixture.json')) ? JSON.parse(readFileSync(join(FIXTURES, dir, 'fixture.json'), 'utf8')) : {};
const run = (cmd: string, cwd: string) => spawnSync(cmd, { cwd, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });

// The offline checks, by tag; C1 (knip) and C5 (npm audit) run their commands.
const OFFLINE: Record<string, (p: Project, o: Options) => string[]> = {
  C2: (p, o) => checkNode(p, o.running),
  C3: checkPins,
  C4: checkLicences,
  C6: checkList,
  C7: checkInstallScripts,
  C8: (p) => checkLockfile(p.lock),
  C9: (p, o) => checkAge(changedEntries(p.lock, null), o.published ?? {}, Date.parse(o.now ?? ''), AGE_EXCEPTIONS),
};

describe('the repo', () => {
  it.each(['C2', 'C3', 'C4', 'C6', 'C7', 'C8'])('passes %s', (check) => {
    expect(OFFLINE[check]?.(repo, { running: process.version })).toEqual([]);
  });

  it("reads ADR-003 §2's approved list", () => {
    const list = approvedList(repo.adr);
    expect(list.get('vitest')).toBe('5.0.5');
    expect(list.get('react-dom')).toBe('19.3.1');
    expect(list.get('next')).toBe('16.4.5');
    expect(list.get('@aws-sdk/s3-request-presigner')).toBe('3.1155.0');
  });

  it('takes its 14-day exceptions only from ADR-003 §5', () => {
    const section5 = repo.adr.slice(repo.adr.indexOf('### 5.'), repo.adr.indexOf('### 6.'));
    for (const x of AGE_EXCEPTIONS) {
      expect(section5, x.name).toContain(`\`${x.name}\``);
      expect(section5).toContain(x.version);
    }
  });
});

describe('ADR-003 check fixtures', () => {
  it.each(CHECKS)('%s has at least one fixture', (check) => {
    expect(fixtures.some((d) => d.startsWith(`${check}-`))).toBe(true);
  });

  it.each(fixtures.filter((d) => (d.split('-')[0] ?? '') in OFFLINE))('%s fails its check', (d) => {
    const tag = d.split('-')[0] ?? '';
    const problems = OFFLINE[tag]?.(loadProject(join(FIXTURES, d), repo), options(d)) ?? [];
    expect(problems.filter((p) => p.startsWith(`[${tag}]`)), problems.join('\n')).not.toHaveLength(0);
  });

  it.each(fixtures.filter((d) => d.startsWith('C1-')))('%s fails knip', (d) => {
    const knip = resolve('node_modules/.bin/knip');
    const r = run(`"${knip}" --directory . --no-progress`, join(FIXTURES, d));
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/Unused dependencies/);
  }, 120_000);

  // Needs the registry's audit endpoint, as CI does.
  it.each(fixtures.filter((d) => d.startsWith('C5-')))('%s fails npm audit', (d) => {
    const r = run('npm audit --package-lock-only --json', join(FIXTURES, d));
    const problems = checkAudit(JSON.parse(r.stdout), loadProject(join(FIXTURES, d), repo).lock);
    expect(problems.filter((p) => p.startsWith('[C5]')), r.stdout.slice(0, 500)).not.toHaveLength(0);
  }, 120_000);
});
