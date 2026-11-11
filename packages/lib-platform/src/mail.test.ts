// RAD-32 (M1-14, ADR-003, ADR-004): email goes through the Mailer. SES in staging and production; in development, CI
// and tests, a mailer that sends nothing and logs only that a message was kept back, to a masked address. A message
// carries a one-time link, so its text never reaches a log.
import { describe, expect, it, vi } from 'vitest';
import { createSesMailer, createUnsentMailer, maskEmail } from './mail.ts';

const MAIL = { to: 'asha.rao@example.in', subject: 'Set your password', text: 'Open https://erp.example.in/invite#token=abc123' };

describe('the mailer', () => {
  it('sends one SES message from MAIL_FROM to the one address, as plain text', async () => {
    const send = vi.fn<(command: { input: unknown }) => Promise<object>>(async () => ({}));
    await createSesMailer({ region: 'ap-south-1', from: 'erp@example.in', client: { send } }).send(MAIL);
    expect(send.mock.calls.map(([c]) => c.input)).toEqual([{
      FromEmailAddress: 'erp@example.in',
      Destination: { ToAddresses: ['asha.rao@example.in'] },
      Content: { Simple: { Subject: { Data: 'Set your password', Charset: 'UTF-8' },
        Body: { Text: { Data: MAIL.text, Charset: 'UTF-8' } } } },
    }]);
  });

  it('in development and CI, sends nothing and logs only a masked address, never the text or its link', async () => {
    const log = { info: vi.fn<(m: string) => void>(), error: vi.fn() };
    await createUnsentMailer(log).send(MAIL);
    expect(log.info.mock.calls).toEqual([['email not sent (development): "Set your password" to a…o@example.in']]);
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/token|abc123|asha/);
  });

  it('masks an address to its first and last letters before the @', () => {
    expect([maskEmail('asha.rao@example.in'), maskEmail('ab@x.in'), maskEmail('a@x.in')])
      .toEqual(['a…o@example.in', 'a…b@x.in', '…@x.in']);
  });
});
