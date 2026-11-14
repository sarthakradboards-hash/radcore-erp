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

describe('RC-007 review: personal data at any depth, under any key (auditor-2 on #39)', () => {
  const line = (fields: Record<string, unknown>) => {
    const { lines, log } = capture();
    log.info('lead saved', fields);
    return { line: lines[0], text: JSON.stringify(lines) };
  };
  const pgFailure = () => Object.assign(new Error('null value in column "phone" violates not-null constraint'),
    { code: '23502', table: 'leads', column: 'phone', detail: 'Failing row contains (Asha Rao, 98765 43210).' });

  it.each<[string, Record<string, unknown>]>([
    ['two objects down', { lead: { contact: { phone: '9876543210', email: 'asha.rao@example.com' } } }],
    ['inside an array', { items: [{ phone: '9876543210', name: 'Asha Rao' }] }],
    ['under a compound key', { leadName: 'Asha Rao', address: '12 MG Road, Pune', customer_phone: '9876543210' }],
    ['as a nested string', { lead: { note: 'call 9876543210, PAN ABCPE1234F' } }],
    ['in an error under any key', { reason: pgFailure() }],
  ])('drops it %s', (_, fields) => {
    expect(line(fields).text).not.toMatch(/Asha|9876543210|98765|asha\.rao|MG Road|ABCPE1234F|Failing row/);
  });

  it('keeps the shape: redacted keys, described errors, harmless keys', () => {
    const { line: l } = line({ items: [{ name: 'Asha Rao', qty: 2 }], companyId: 'c1', reason: pgFailure(),
      deep: { a: { b: { c: { d: { e: { f: 'x' } } } } } } });
    expect(l).toMatchObject({ items: [{ name: '[redacted]', qty: 2 }], companyId: 'c1',
      reason: { name: 'Error', code: '23502', table: 'leads', column: 'phone' } });
    expect(JSON.stringify(l)).toContain('[too deep]');
  });

  it('scrubs a child logger\'s bindings too', () => {
    const { lines, log } = capture();
    log.child({ requestId: 'r1', user: { email: 'asha.rao@example.com' } }).info('x');
    expect(lines[0]).toMatchObject({ requestId: 'r1', user: { email: '[redacted]' } });
  });
});

describe('RC-007 review: messages that quote their input', () => {
  it('masks the value in PostgreSQL 22P02', () => {
    const e = Object.assign(new Error('invalid input syntax for type integer: "Asha Rao"'), { code: '22P02' });
    expect(describeError(e)).toMatchObject({ code: '22P02', message: 'invalid input syntax for type integer: "…"' });
  });

  it("masks the body in Node's JSON.parse error", () => {
    let err: unknown;
    try {
      JSON.parse('Asha Rao 9876543210');
    } catch (e) {
      err = e;
    }
    expect(describeError(err)).toMatchObject({ name: 'SyntaxError', message: 'The text is not valid JSON' });
  });

  it.each(['{"name": Asha Rao, "phone": "98765"}', '{"name": "Asha', '["Asha Rao"'])(
    'gives every JSON.parse failure one fixed message (auditor-2 SHOULD): %s', (body) => {
      let err: unknown;
      try {
        JSON.parse(body);
      } catch (e) {
        err = e;
      }
      expect(describeError(err).message).toBe('The text is not valid JSON');
    });
});

describe('key spellings the word split missed (auditor-2 SHOULD)', () => {
  it.each(['PANNumber', 'IFSCCode', 'GSTINValue', 'firstname', 'username', 'fullname', 'phonenumber', 'emailid'])(
    'redacts %s', (key) => {
      const { lines, log } = capture();
      log.info('x', { [key]: 'Asha Rao' });
      expect(lines[0]?.[key]).toBe('[redacted]');
    });

  it.each(['panel', 'companyId', 'requestId', 'planCode', 'qty'])('keeps %s', (key) => {
    const { lines, log } = capture();
    log.info('x', { [key]: 'c1' });
    expect(lines[0]?.[key]).toBe('c1');
  });
});

describe('tokens without a digit (auditor-2 SHOULD)', () => {
  it('treats a long segment as a token and anything after Bearer as a credential', () => {
    expect(routeOf('/api/public/shares/abcdefghijklmnopqrstuvwxyzAB')).toBe('/api/public/shares/:token');
    expect(routeOf('/api/accounts/parties')).toBe('/api/accounts/parties');
    expect(scrubText('Authorization: Bearer abcdefghijklmnopqrstuvwxyzABCDEF')).toBe('Authorization: Bearer [token]');
  });
});

describe('auditor-2 SHOULDs at 8f4a910: messages that carry their input unquoted', () => {
  const thrown = (f: () => unknown): unknown => {
    try {
      f();
    } catch (e) {
      return e;
    }
    throw new Error('expected a throw');
  };

  it.each<[string, () => unknown, string]>([
    // decimal.js 10 writes this exact message (a plain Error); lib-platform doesn't depend on it.
    ['Decimal', () => { throw new Error('[DecimalError] Invalid argument: Asha Rao'); }, '[DecimalError] Invalid argument: …'],
    ['BigInt', () => BigInt('Asha Rao'), 'Cannot convert … to a BigInt'],
    ['RegExp', () => new RegExp('Asha (Rao'), 'Invalid regular expression: /…/: Unterminated group'],
    ['a time zone', () => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asha Rao' }), 'Invalid time zone specified: …'],
    ['an encoding', () => Buffer.from('x').toString('Asha Rao' as BufferEncoding), 'Unknown encoding: …'],
    ['structuredClone', () => structuredClone({ f: () => 'Asha Rao' }), '… could not be cloned.'],
    // The auditor's SHOULD on #59: Intl quotes a currency code without quotes.
    ['a currency', () => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'Asha Rao' }), 'Invalid currency code : …'],
  ])('drops the input from a %s error and keeps the rest', (_, f, message) => {
    expect(describeError(thrown(f)).message).toBe(message);
  });

  // The auditor's other SHOULD on #59. Node 26's Temporal names what was wrong and never the text; if a Node update
  // starts quoting the input, this fails and the message gets a row above. Node 24 has no Temporal, so it skips there.
  const temporal = (globalThis as { Temporal?: Record<string, { from(s: string): unknown }> }).Temporal;
  it.skipIf(temporal === undefined).each(['PlainDate', 'PlainDateTime', 'PlainTime', 'Instant', 'ZonedDateTime', 'Duration',
    'PlainYearMonth', 'PlainMonthDay'])("keeps no input from Temporal.%s.from's parse error", (kind) => {
    const message = describeError(thrown(() => temporal?.[kind]?.from('Asha Rao 9876543210'))).message;
    expect(message).toMatch(/^Temporal error: /);
    expect(message).not.toMatch(/Asha|9876/);
  });
});

describe('auditor-2 SHOULDs at 8f4a910: key spellings', () => {
  const kept = (key: string) => {
    const { lines, log } = capture();
    log.info('x', { [key]: 'nightly-close' });
    return lines[0]?.[key];
  };

  it.each(['workemail', 'billingaddress', 'apisecret', 'accesstoken', 'aadhar', 'aadharNumber', 'customer_aadhar',
    'name', 'leadName', 'contact_name', 'firstname', 'accountnumber', 'bankaccount'])('redacts %s', (key) => {
    expect(kept(key)).toBe('[redacted]');
  });

  it.each(['jobName', 'queueName', 'tableName', 'queue_name', 'tablename', 'hostname', 'fileName', 'panel'])(
    'keeps %s, which names a thing in the system', (key) => {
      expect(kept(key)).toBe('nightly-close');
    });
});
