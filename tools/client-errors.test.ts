// RAD-29 (RC-158): the list of web pages a browser error report may name is exactly the web app's pages. A page added
// without its line would report as `unknown`, so it fails here first. Route groups, `(app)`, aren't in the URL.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_PAGES } from '@radcore/lib-platform';
import { expect, it } from 'vitest';

function pages(dir: string, at: string[] = []): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return pages(join(dir, e.name), /^\(.*\)$/.test(e.name) ? at : [...at, e.name]);
    return e.name === 'page.tsx' ? [`/${at.join('/')}`] : [];
  });
}

it("lists exactly the web app's pages", () => {
  expect([...WEB_PAGES].sort()).toEqual(pages('apps/web/app').sort());
});
