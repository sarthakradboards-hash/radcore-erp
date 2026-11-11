// RAD-43: the web CSP lets a page upload to the files bucket (a presigned POST, by fetch or by a form) and show a
// preview from it, and still blocks every other origin. Nothing listens at the bucket origin in e2e, so a route answers
// for it; the fixture fails the test on any CSP violation, which is what this proves.
import { expect, test } from './fixtures.ts';

// The web server's S3_FILES_ORIGIN in playwright.config.ts (SeaweedFS's origin, as dev uses).
const FILES = 'http://127.0.0.1:8333';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('the CSP lets the page post an upload to the files bucket and show a preview from it', async ({ page }) => {
  await page.route(`${FILES}/**`, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    : route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })));
  await page.goto('/');

  // connect-src: the upload as the screens send it, a multipart POST to the bucket URL the presign returns.
  const status = await page.evaluate(async (files) => {
    const body = new FormData();
    body.append('key', 'uploads/k');
    body.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    return (await fetch(`${files}/radcore-files`, { method: 'POST', body })).status;
  }, FILES);
  expect(status).toBe(204);

  // form-action: the same POST from a form. A 204 answer keeps the page where it is.
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url() === `${FILES}/radcore-files` && r.isNavigationRequest());
  await page.evaluate((files) => {
    const form = Object.assign(document.createElement('form'), { method: 'post', action: `${files}/radcore-files` });
    document.body.append(form);
    form.submit();
  }, FILES);
  await posted;

  // img-src: a preview from a presigned GET.
  const loaded = await page.evaluate((files) => new Promise<boolean>((resolve) => {
    const img = Object.assign(new Image(), { src: `${files}/radcore-files/uploads/k.png` });
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  }), FILES);
  expect(loaded).toBe(true);
});

test('the CSP still blocks an upload to any other origin', async ({ page, pageProblems }) => {
  await page.goto('/');
  await page.evaluate(() => fetch('http://127.0.0.1:8334/radcore-files', { method: 'POST', body: 'x' }).catch(() => undefined));
  await expect.poll(() => pageProblems).toContainEqual(expect.stringMatching(/^CSP violation: connect-src blocked http:\/\/127\.0\.0\.1:8334/));
  // The blocked fetch may also be reported as a failed request just after; let it land, then clear what was planted.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(pageProblems.every((p) => p.includes('127.0.0.1:8334'))).toBe(true);
  pageProblems.length = 0;
});
