// Sending email (M1-14, ADR-003, ADR-004): invite and password-reset links. Services and jobs take a Mailer, so tests,
// development and CI use one that sends nothing. A message carries a one-time link, so neither mailer ever logs its
// text; only a masked address is logged. The SES identity and production access are a devops step (Gate 0).
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { Config } from './config.ts';
import type { Logger } from './log.ts';

export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send(mail: Mail): Promise<void> };

/** `asha.rao@example.in` as `a…o@example.in`: enough to tell which address, not enough to read it. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  const kept = local.length >= 2 ? `${local[0] ?? ''}…${local.at(-1) ?? ''}` : '…';
  return `${kept}${address.slice(at)}`;
}

type SesClient = { send(command: SendEmailCommand): Promise<unknown> };

/** SES, from MAIL_FROM, in the deployment's region (ADR-003: both come only from settings). */
export function createSesMailer({ region, from, client }: { region: string; from: string; client?: SesClient }): Mailer {
  const ses: SesClient = client ?? new SESv2Client({ region });
  return {
    async send({ to, subject, text }) {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } } },
      }));
    },
  };
}

/** Development, CI and tests: sends nothing, and says so with the subject and a masked address only. */
export function createUnsentMailer(log: Logger): Mailer {
  return {
    async send({ to, subject }) {
      log.info(`email not sent (development): "${subject}" to ${maskEmail(to)}`);
    },
  };
}

/** The mailer for these settings: SES where MAIL_FROM is set (staging and production), otherwise one that sends nothing. */
export function mailerFor(config: Config, log: Logger): Mailer {
  return config.mailFrom === null ? createUnsentMailer(log) : createSesMailer({ region: config.s3.region, from: config.mailFrom });
}
