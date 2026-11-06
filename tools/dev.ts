// `npm run dev`: the API, the worker and the web app side by side. When one stops, the others are stopped too.
import { spawn } from 'node:child_process';
import { writeDevEnv } from './dev-env.ts';

writeDevEnv();
const children = ['@radcore/api', '@radcore/worker', '@radcore/web'].map((ws) =>
  // One command string through the shell, because npm is npm.cmd on Windows. ws is a constant from the list above.
  spawn(`npm run dev -w ${ws}`, { stdio: 'inherit', shell: true }));
for (const child of children)
  child.on('exit', (code) => {
    for (const other of children) if (other !== child) other.kill();
    process.exitCode = code ?? 1;
  });
