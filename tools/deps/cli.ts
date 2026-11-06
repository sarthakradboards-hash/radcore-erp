// `npm run deps:check` and CI: ADR-003's dependency checks on this repo. Uses only Node's own modules, so CI runs the
// lockfile checks (C8) and the audit (C5) before `npm ci` installs anything.
//   node tools/deps/cli.ts [--only C5,C8] [--base <git ref>]
// --base compares the lockfile with the base branch's for C9; without it, every entry counts as changed.
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
  changedEntries, checkAge, checkAudit, checkInstallScripts, checkLicences, checkList, checkLockfile, checkNode, checkPins,
  entryName, type Lock,
} from './checks.ts';
import { AGE_EXCEPTIONS, loadProject } from './project.ts';

const { values } = parseArgs({ options: { only: { type: 'string' }, base: { type: 'string' } } });
const only = values.only?.split(',');
const run = (check: string) => !only || only.includes(check);
const project = loadProject('.');
const problems: string[] = [];

if (run('C2')) problems.push(...checkNode(project, process.version));
if (run('C3')) problems.push(...checkPins(project));
if (run('C4')) problems.push(...checkLicences(project));
if (run('C6')) problems.push(...checkList(project));
if (run('C7')) problems.push(...checkInstallScripts(project));
if (run('C8')) problems.push(...checkLockfile(project.lock));

if (run('C5')) {
  // npm audit exits 1 when it finds anything; the thresholds are ours, so read its report either way.
  // One fixed command string through the shell, because npm is npm.cmd on Windows.
  const audit = spawnSync('npm audit --package-lock-only --json', { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  if (!audit.stdout) throw new Error(`npm audit gave no report: ${audit.stderr}`);
  problems.push(...checkAudit(JSON.parse(audit.stdout), project.lock));
}

if (run('C9')) {
  let base: Lock | null = null;
  if (values.base) {
    try {
      base = JSON.parse(execFileSync('git', ['show', `${values.base}:package-lock.json`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as Lock;
    } catch {
      console.log(`C9: no lockfile at ${values.base}; checking every entry`);
    }
  }
  const changed = changedEntries(project.lock, base);
  const published: Record<string, string | undefined> = {};
  // The registry's full document has each version's publish time; fetch each changed package once.
  const names = [...new Set(changed.map((id) => id.slice(0, id.lastIndexOf('@'))))];
  for (let i = 0; i < names.length; i += 16) {
    await Promise.all(names.slice(i, i + 16).map(async (name) => {
      const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
      if (!res.ok) return;
      const doc = (await res.json()) as { time?: Record<string, string> };
      for (const id of changed) if (id.slice(0, id.lastIndexOf('@')) === name) published[id] = doc.time?.[id.slice(id.lastIndexOf('@') + 1)];
    }));
  }
  console.log(`C9: ${changed.length} lockfile entries added or changed`);
  problems.push(...checkAge(changed, published, Date.now(), AGE_EXCEPTIONS));
}

const checked = only?.join(', ') ?? 'C2 to C9';
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in ${checked} (ADR-003).`);
  process.exitCode = 1;
} else {
  console.log(`ADR-003 ${checked}: OK (${Object.keys(project.lock.packages).filter((k) => k).length} lockfile entries, ${
    new Set(Object.entries(project.lock.packages).map(([k, e]) => entryName(k, e))).size} packages).`);
}
