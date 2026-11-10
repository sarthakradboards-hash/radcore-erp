// The kit gallery never runs on a deployed web server (coordinator, RAD-53).
import { expect, it } from 'vitest';
import { kitPageProblem } from './kit-guard.ts';

it.each([
  [{}, null],
  [{ APP_ENV: 'production' }, null],
  [{ KIT_PAGE: '', APP_ENV: 'production' }, null],
  [{ KIT_PAGE: '1', APP_ENV: 'ci' }, null],
  [{ KIT_PAGE: '1', APP_ENV: 'development' }, null],
  [{ KIT_PAGE: '1', APP_ENV: 'production' }, 'KIT_PAGE must not be set when APP_ENV is production (the UI kit page is for tests only)'],
  [{ KIT_PAGE: '1', APP_ENV: 'staging' }, 'KIT_PAGE must not be set when APP_ENV is staging (the UI kit page is for tests only)'],
  [{ KIT_PAGE: '1', APP_ENV: 'review' }, 'KIT_PAGE must not be set when APP_ENV is review (the UI kit page is for tests only)'],
  [{ KIT_PAGE: '1', APP_ENV: 'Production' }, 'KIT_PAGE must not be set when APP_ENV is Production (the UI kit page is for tests only)'],
  [{ KIT_PAGE: '0' }, 'KIT_PAGE must not be set when APP_ENV is not set (the UI kit page is for tests only)'],
])('%j → %s', (env, problem) => {
  expect(kitPageProblem(env)).toBe(problem);
});
