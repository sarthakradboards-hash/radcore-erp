// RAD-122: how a lead's owner and name read when the server sends no name for them.
import { expect, it } from 'vitest';
import { leadName, ownerText } from './shared.ts';

const me = '0193b1c2-3d4e-7f80-9a1b-2c3d4e5f6a70';

it('says whose a lead is from its owner principal', () => {
  expect(ownerText(null, me)).toBe('No one');
  expect(ownerText(`user:${me}`, me)).toBe('You');
  expect(ownerText('user:0193b1c2-3d4e-7f80-9a1b-2c3d4e5f6a71', me)).toBe('Someone else');
  // A bare id is not this person: the owner is always a principal.
  expect(ownerText(me, me)).toBe('Someone else');
});

it('names a lead by its name, else by the digits its phone keeps', () => {
  expect(leadName('Asha', { masked: '••••••3210' })).toBe('Asha');
  expect(leadName(null, { masked: '••••••3210' })).toBe('Lead ending 3210');
  expect(leadName(null, '+919876543210')).toBe('Lead ending 3210');
  expect(leadName(null, { masked: '••••••' })).toBe('No name given');
});
