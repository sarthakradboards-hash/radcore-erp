// RAD-43: the files bucket's origin the web CSP allows, and the start check that refuses anything else.
import { expect, it } from 'vitest';
import { filesOrigin } from './files-origin.ts';
import { webSettingsProblem } from './web-settings.ts';

const aws = 'https://radcore-files.s3.ap-south-1.amazonaws.com';

it.each<[string, Record<string, string>, string | null]>([
  ['the bucket over https in production', { APP_ENV: 'production', S3_FILES_ORIGIN: aws }, aws],
  ['SeaweedFS over http in development', { APP_ENV: 'development', S3_FILES_ORIGIN: 'http://127.0.0.1:8333' }, 'http://127.0.0.1:8333'],
  ['SeaweedFS over http in CI', { APP_ENV: 'ci', S3_FILES_ORIGIN: 'http://127.0.0.1:8333' }, 'http://127.0.0.1:8333'],
  ['nothing set', { APP_ENV: 'production' }, null],
  ['an empty value', { APP_ENV: 'production', S3_FILES_ORIGIN: '' }, null],
  ['http outside development and CI', { APP_ENV: 'staging', S3_FILES_ORIGIN: 'http://radcore-files.example' }, null],
  ['http with APP_ENV unset', { S3_FILES_ORIGIN: 'http://127.0.0.1:8333' }, null],
  ['a wildcard host', { APP_ENV: 'production', S3_FILES_ORIGIN: 'https://*.s3.ap-south-1.amazonaws.com' }, null],
  ['a path (the bucket in path style)', { APP_ENV: 'production', S3_FILES_ORIGIN: `${aws}/radcore-files` }, null],
  ['a trailing slash', { APP_ENV: 'production', S3_FILES_ORIGIN: `${aws}/` }, null],
  ['another scheme', { APP_ENV: 'production', S3_FILES_ORIGIN: 'ftp://files.example' }, null],
  ['not a URL', { APP_ENV: 'production', S3_FILES_ORIGIN: 'radcore-files' }, null],
])('accepts only a bare origin: %s', (_, env, expected) => {
  expect(filesOrigin(env)).toBe(expected);
  expect(webSettingsProblem(env) === null).toBe(expected !== null);
});
