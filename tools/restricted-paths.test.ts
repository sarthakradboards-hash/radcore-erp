// The restricted security appendix (02b) is never committed, in any folder or spelling (RAD-12). .gitignore keeps it
// out of `git add`; this test is the second guard, over every tracked path, case-insensitively.
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

// The .gitignore patterns (`*02b-Restricted-Security-Appendix*`, `*02b*Restricted*`, `*Restricted-Security-Appendix*`),
// with any case and any of - _ . or space between the words.
const RESTRICTED = /02b.*restricted|restricted[-_. ]*security[-_. ]*appendix/i;

it('tracks no file named like the restricted appendix', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0');
  expect(tracked.filter((p) => RESTRICTED.test(p))).toEqual([]);
});

it('catches the spellings .gitignore names, in any case', () => {
  for (const p of ['docs/source/02b-Restricted-Security-Appendix.md', 'x/02B-RESTRICTED-SECURITY-APPENDIX.pdf',
    '02b_restricted.docx', 'old/02b restricted notes.md', 'Restricted Security Appendix.md', 'a/restricted.security.appendix.txt']) {
    expect(RESTRICTED.test(p), p).toBe(true);
  }
  for (const p of ['docs/source/02-Technical-Report.md', 'docs/register.md', 'packages/db/src/sales/tables.ts']) {
    expect(RESTRICTED.test(p), p).toBe(false);
  }
});
