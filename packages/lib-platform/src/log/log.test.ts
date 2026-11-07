// RC-007 and RC-077: structured lines with a level and request id, and no personal data, token or failed query's
// values in any of them.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLog, describeError, routeOf, scrubText } from '../index.ts';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({ write(chunk: Buffer, _enc, done) {
    for (const l of chunk.toString('utf8').split('\n').filter(Boolean)) lines.push(JSON.parse(l) as Record<string, unknown>);
    done();
  } });
  return { lines, log: createLog({ level: 'debug', service: 'api', destination }) };
};

// What drizzle-orm 0.45 throws when PostgreSQL refuses an insert: the SQL and every bound value in the message, and
// node-postgres's error, with the row in `detail`, as the cause.
function failedLeadInsert(): Error {
  const pg = Object.assign(new Error('value too long for type character varying(10)'), {
    code: '22001', table: 'leads', column: 'phone', routine: 'varchar', detail: 'Failing row contains (Asha Rao, 98765 43210).',
  });
  // <sql> stands for the statement text, which L2 keeps out of source files.
  return Object.assign(new Error('Failed query: <sql>\nparams: Asha Rao,98765 43210'),
    { name: 'DrizzleQueryError', cause: pg });
}

describe('RC-007: a failed query leaves no personal data in the log', () => {
  it('keeps the code, table and column, and drops the SQL, params and detail', () => {
    const d = describeError(failedLeadInsert());
    expect(d).toMatchObject({ name: 'DrizzleQueryError', message: 'Failed query', code: '22001', table: 'leads', column: 'phone' });
    expect(JSON.stringify(d)).not.toMatch(/Asha|98765|<sql>|params|Failing row/);
  });

  it('writes the same safe description when the error is logged', () => {
    const { lines, log } = capture();
    log.child({ requestId: 'req-1' }).error('saving the lead failed', failedLeadInsert(), { route: '/crm/leads' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 50, service: 'api', requestId: 'req-1', route: '/crm/leads',
      msg: 'saving the lead failed', err: { code: '22001', table: 'leads' } });
    expect(JSON.stringify(lines)).not.toMatch(/Asha|98765|params|Failing row/);
  });

  it('redacts secret keys and scrubs messages and string fields', () => {
    const { lines, log } = capture();
    log.info('signed in asha.rao@example.com from +91 98765 43210', {
      password: 'Zq3vR8kLm2', user: { email: 'asha.rao@example.com', phone: '9876543210' }, note: 'PAN ABCPE1234F',
    });
    const s = JSON.stringify(lines);
    expect(s).not.toMatch(/asha|98765|9876543210|Zq3vR8kLm2|ABCPE1234F/);
    expect(lines[0]).toMatchObject({ password: '[redacted]', user: { email: '[redacted]', phone: '[redacted]' },
      note: 'PAN [pan]', msg: 'signed in [email] from [phone]' });
  });

  it('logs a public link by its route template, never its token (ADR-004)', () => {
    expect(routeOf('/api/public/payslips/k3N9vQ2xR7mT4pW8zY1sAbC9?x=1')).toBe('/api/public/payslips/:token');
    expect(routeOf('/api/sales/invoices/3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01/print')).toBe('/api/sales/invoices/:id/print');
    expect(routeOf('/api/sales/invoices')).toBe('/api/sales/invoices');
  });
});

describe('scrubText', () => {
  it.each([
    ['call 98765 43210 or +91-9876543210', 'call [phone] or [phone]'],
    ['GSTIN 27AAPFU0939F1ZV, PAN AAPFU0939F', 'GSTIN [gstin], PAN [pan]'],
    ['IFSC HDFC0001234 a/c 50100123456789', 'IFSC [ifsc] a/c [number]'],
    ['Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIz', 'Bearer [token]'],
    ['invoice INV-2026-0042 for 1,250.50 on 07-11-2026', 'invoice INV-2026-0042 for 1,250.50 on 07-11-2026'],
  ])('%s', (input, want) => expect(scrubText(input)).toBe(want));
});

describe('RC-077: levels', () => {
  it('drops lines below the configured level', () => {
    const lines: string[] = [];
    const destination = new Writable({ write(c: Buffer, _e, done) { lines.push(c.toString()); done(); } });
    const log = createLog({ level: 'warn', service: 'worker', destination });
    log.info('quiet');
    log.warn('loud');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"loud"');
  });
});
