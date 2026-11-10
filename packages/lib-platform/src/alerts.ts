// Alerts and the worker's heartbeat (ADR-004 §2, §5; RAD-44 step 4), both over ADR-002 L8's outbound client. Their
// URLs carry a token in the path, so both clients log the origin only (`logPath: false`). In development and CI the
// settings are unset: an alert is an error log line, and there's no heartbeat.
import { createOutbound, type Transport } from './http/outbound.ts';
import type { Logger } from './log.ts';

/** Raises an alert for people to act on. The message must already be safe to show: never a payload or a secret. */
export type Alerter = (message: string) => Promise<void>;

/** ADR-004 §2: the worker sends one every 5 minutes; the outside monitor alerts after 15 without one. */
const HEARTBEAT_EVERY_MS = 5 * 60_000;

// At most this many alerts posted per window; the rest of a burst stays in the logs (auditor-2, RAD-44).
const ALERT_BURST = 10;
const ALERT_WINDOW_MS = 5 * 60_000;

const originOf = (url: string): string => new URL(url).origin;

/**
 * An alert is always logged first, as `ALERT: <message>`. With ALERT_WEBHOOK_URL set it is also posted there as
 * `{ "text": … }` (the shape Slack and Google Chat incoming webhooks take). A failed send is logged and not thrown:
 * the log line already carries the alert, and the caller (a dead-letter worker) has nothing better to do with it.
 *
 * Bursts are capped: at most `burst` alerts are posted per `windowMs`. The next one posts a single notice that the
 * cap was reached, and the rest are only logged until the window ends, so a mass failure (a provider down, a
 * thousand jobs dead-lettering) doesn't flood the channel or get the webhook rate-limited.
 */
export function createAlerter(webhookUrl: string | null, log: Logger,
  { transport, burst = ALERT_BURST, windowMs = ALERT_WINDOW_MS }: { transport?: Transport; burst?: number; windowMs?: number } = {},
): Alerter {
  const client = webhookUrl === null ? null : createOutbound(
    { name: 'alert', allowedOrigins: [originOf(webhookUrl)], logPath: false }, { log, ...(transport && { transport }) });
  const span = { start: Number.NEGATIVE_INFINITY, posted: 0 };
  const post = async (url: string, text: string): Promise<void> => {
    if (client === null) return;
    try {
      const res = await client.request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }) });
      if (res.status >= 300) log.error(`alert: the webhook answered ${res.status}, so the alert above was not delivered`);
    } catch (err) {
      log.error('alert: the webhook could not be reached, so the alert above was not delivered', err);
    }
  };
  return async (message) => {
    log.error(`ALERT: ${message}`);
    if (webhookUrl === null) return;
    const now = Date.now();
    if (now - span.start >= windowMs) Object.assign(span, { start: now, posted: 0 });
    span.posted += 1;
    if (span.posted <= burst) await post(webhookUrl, message);
    else if (span.posted === burst + 1) {
      await post(webhookUrl, `more than ${burst} alerts within ${Math.round(windowMs / 60_000)} minutes: the rest `
        + 'until then are in the logs only');
    }
  };
}

/**
 * Pings HEARTBEAT_URL now and every `everyMs` until stopped. A missed ping is logged; the outside monitor's alert on
 * silence is the real signal. shortcut: this proves the process and its network are up, not that jobs run; move it
 * onto the job queue as a scheduled job once jobs get their ctx (M1-08).
 */
export function startHeartbeat(url: string | null, log: Logger,
  { everyMs = HEARTBEAT_EVERY_MS, transport }: { everyMs?: number; transport?: Transport } = {},
): { name: string; stop(): Promise<void> } {
  if (url === null) return { name: 'heartbeat', stop: async () => undefined };
  const client = createOutbound({ name: 'heartbeat', allowedOrigins: [originOf(url)], logPath: false },
    { log, ...(transport && { transport }) });
  const beat = async (): Promise<void> => {
    try {
      const res = await client.request(url);
      if (res.status >= 300) log.error(`heartbeat: the monitor answered ${res.status}`);
    } catch (err) {
      log.error('heartbeat: the monitor could not be reached', err);
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), everyMs);
  timer.unref();
  return { name: 'heartbeat', stop: async () => clearInterval(timer) };
}
