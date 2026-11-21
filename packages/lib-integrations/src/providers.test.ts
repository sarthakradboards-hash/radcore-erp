// RAD-107: each provider's proof and parse, on fixtures shaped like the providers' published payloads (the live Meta
// and WhatsApp connections come with M7).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Outbound } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';
import { googleKeyed, googleLeadCheck, parseGoogleLead } from './google.ts';
import { hubAsks, hubChallenge, hubSignature, hubSigned, sameSecret } from './hub.ts';
import { leadgenNotices, parseMetaLead } from './meta.ts';
import { TURNSTILE_ORIGIN, TURNSTILE_TEST_SECRETS, turnstilePasses, turnstileSecretFor } from './turnstile.ts';
import { whatsappMessages } from './whatsapp.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];

describe('the shared proof', () => {
  it('compares secrets whole, in constant time', () => {
    expect([sameSecret('abc', 'abc'), sameSecret('abc', 'abd'), sameSecret('abc', 'abcd'), sameSecret('', '')]).toEqual([true, false, false, true]);
  });

  it('passes a body signed with the app secret, and nothing else', () => {
    const raw = Buffer.from(fixture('whatsapp-messages.json'));
    const signed = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    expect(hubSignature(raw, headers({ 'x-hub-signature-256': signed }), 'app-secret')).toEqual({ valid: true, deliveryId: null });
    // Another secret, an altered body, no header, an old sha1 header, and no stored secret are all refused.
    expect(hubSignature(raw, headers({ 'x-hub-signature-256': signed }), 'other')).toEqual({ valid: false });
    expect(hubSignature(Buffer.concat([raw, Buffer.from(' ')]), headers({ 'x-hub-signature-256': signed }), 'app-secret')).toEqual({ valid: false });
    expect(hubSignature(raw, headers({}), 'app-secret')).toEqual({ valid: false });
    expect(hubSignature(raw, headers({ 'x-hub-signature-256': signed.replace('sha256=', 'sha1=') }), 'app-secret')).toEqual({ valid: false });
    expect(hubSignature(raw, headers({ 'x-hub-signature-256': signed }), null)).toEqual({ valid: false });
  });

  it('refuses before any secret is read what couldn’t pass: no signature of the right shape, or no handshake', () => {
    const raw = Buffer.from('{}');
    expect([hubSigned(raw, headers({ 'x-hub-signature-256': `sha256=${'a'.repeat(64)}` })), hubSigned(raw, headers({})),
      hubSigned(raw, headers({ 'x-hub-signature-256': 'sha256=00' })), hubSigned(raw, headers({ 'x-hub-signature-256': `sha1=${'a'.repeat(40)}` }))])
      .toEqual([true, false, false, false]);
    const q = (h: Record<string, string>) => (name: string) => h[name];
    expect([hubAsks(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 't', 'hub.challenge': '1' })), hubAsks(q({ 'hub.mode': 'subscribe' })),
      hubAsks(q({ 'hub.verify_token': 't', 'hub.challenge': '1' }))]).toEqual([true, false, false]);
  });

  it('answers the subscription handshake only with the stored verify token', () => {
    const q = (h: Record<string, string>) => (name: string) => h[name];
    const asked = { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok-123', 'hub.challenge': '1158201444' };
    expect(hubChallenge(q(asked), 'tok-123')).toBe('1158201444');
    expect(hubChallenge(q(asked), 'tok-124')).toBeNull();
    expect(hubChallenge(q(asked), null)).toBeNull();
    expect(hubChallenge(q({ ...asked, 'hub.mode': 'unsubscribe' }), 'tok-123')).toBeNull();
    expect(hubChallenge(q({ 'hub.mode': 'subscribe', 'hub.challenge': '1' }), 'tok-123')).toBeNull();
  });
});

describe('Google lead forms', () => {
  const raw = Buffer.from(fixture('google-lead.json'));

  it('takes a lead only with the form’s own key, never without one, keyed on the lead id (RC-054)', () => {
    expect(googleLeadCheck(raw, headers({}), 'a-key-set-on-the-form')).toEqual({ valid: true,
      deliveryId: 'TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxyz-0123456789-AaBb' });
    expect(googleLeadCheck(raw, headers({}), 'a-campaign-token')).toEqual({ valid: false });
    expect(googleLeadCheck(raw, headers({}), null)).toEqual({ valid: false });
    expect(googleLeadCheck(raw, headers({}), '')).toEqual({ valid: false });
    expect(googleLeadCheck(Buffer.from('not json'), headers({}), 'a-key-set-on-the-form')).toEqual({ valid: false });
    // Before the stored key is read: a lead with a key at all.
    expect([googleKeyed(raw), googleKeyed(Buffer.from('not json')),
      googleKeyed(Buffer.from(JSON.stringify({ lead_id: 'x', google_key: '', user_column_data: [] })))]).toEqual([true, false, false]);
  });

  it('reads the answers by Google’s column ids', () => {
    expect(parseGoogleLead(raw.toString())).toEqual({ phone: '+919876543210', name: 'Kiran Rao', email: 'kiran@example.test' });
    const split = JSON.stringify({ lead_id: 'x', google_key: 'k', user_column_data: [{ column_id: 'FIRST_NAME', string_value: 'Asha' },
      { column_id: 'LAST_NAME', string_value: 'Menon' }] });
    expect(parseGoogleLead(split)).toEqual({ phone: undefined, name: 'Asha Menon', email: undefined });
  });
});

describe('Meta lead ads', () => {
  it('names each lead a notification holds, and none for another object', () => {
    expect(leadgenNotices(fixture('meta-leadgen-notification.json')))
      .toEqual([{ leadgenId: '444444444444', formId: '444444444444', pageId: '444444444444' }]);
    expect(leadgenNotices(JSON.stringify({ object: 'instagram', entry: [] }))).toEqual([]);
  });

  it('reads a fetched lead’s standard fields', () => {
    expect(parseMetaLead(fixture('meta-lead.json'))).toEqual({ id: '444444444444', phone: '+919812345678', name: 'Asha Menon',
      email: 'asha@example.test', createdAt: new Date('2026-01-03T10:00:00Z') });
  });
});

describe('WhatsApp messages', () => {
  it('reads each message with its sender’s number and name, the text kept as written, and skips status updates', () => {
    expect(whatsappMessages(fixture('whatsapp-messages.json'))).toEqual([
      { phone: '+919700011122', name: 'Ravi Kumar', text: 'Is the blue scooter in stock? <b>Call me</b>', at: new Date(1_767_436_800_000) },
      { phone: '+919700033344', name: 'Meera', text: undefined, at: new Date(1_767_436_860_000) },
    ]);
  });
});

describe('Turnstile', () => {
  /** An outbound client that answers once, and remembers what it was sent. */
  const answering = (status: number, body: string) => {
    const sent: { url: string; body: string }[] = [];
    const outbound: Outbound = { request: (url, init) => {
      sent.push({ url: String(url), body: String(init?.body ?? '') });
      return Promise.resolve({ status, headers: {}, body: Buffer.from(body), url: String(url) });
    } };
    return { outbound, sent };
  };

  it('sends only the token and the secret to siteverify, never the visitor’s address', async () => {
    const { outbound, sent } = answering(200, '{"success":true,"error-codes":[]}');
    expect(await turnstilePasses(outbound, 'the-secret', 'the-token')).toBe(true);
    expect(sent).toEqual([{ url: `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`, body: 'secret=the-secret&response=the-token' }]);
  });

  it('uses a test secret only in development, CI and the review copy, which fails closed, and nowhere else', () => {
    expect([turnstileSecretFor('production', 'real'), turnstileSecretFor('development', null), turnstileSecretFor('ci', null),
      turnstileSecretFor('review', null)]).toEqual(['real', TURNSTILE_TEST_SECRETS.passes, TURNSTILE_TEST_SECRETS.passes,
      TURNSTILE_TEST_SECRETS.fails]);
    for (const env of ['staging', 'production', 'anything']) expect(() => turnstileSecretFor(env, null)).toThrow(/TURNSTILE_SECRET is required/);
  });

  it('refuses a failed token, an error status and an unreadable answer', async () => {
    expect(await turnstilePasses(answering(200, '{"success":false,"error-codes":["timeout-or-duplicate"]}').outbound, 's', 't')).toBe(false);
    expect(await turnstilePasses(answering(500, '{"success":true}').outbound, 's', 't')).toBe(false);
    expect(await turnstilePasses(answering(200, '<html>').outbound, 's', 't')).toBe(false);
  });
});
