// `npm run dev`: the API, the worker and the web app side by side. When one stops, or on Ctrl+C, all of them stop.
import { spawn, spawnSync } from 'node:child_process';
import { writeDevEnv } from './dev-env.ts';

// npm sets this to its own CLI script, so each workspace runs through the same npm without a shell.
const npm = process.env['npm_execpath'];
if (!npm) throw new Error('Run this through `npm run dev`.');

writeDevEnv();
const children = ['@radcore/api', '@radcore/worker', '@radcore/web'].map((ws) =>
  spawn(process.execPath, [npm, 'run', 'dev', '-w', ws], { stdio: 'inherit' }));

// Windows doesn't pass a stop on to grandchildren (next dev, node --watch), so stop each whole process tree.
const stopAll = () => {
  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
};
for (const child of children)
  child.on('exit', (code) => {
    process.exitCode ??= code ?? 1;
    stopAll();
  });
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
