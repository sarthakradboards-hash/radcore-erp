// RAD-122: how a lead's owner and name read when the server sends no name for them.
import { expect, it } from 'vitest';
import { leadName, ownerText, shownStep } from './shared.ts';

it('names the plan step the shown follow-up belongs to: the one before the server’s planStep (e2e-2 on #334)', () => {
  const steps = [{ step: 1 }, { step: 2 }, { step: 3 }];
  expect(shownStep(steps, 2)).toBe(1); // just put on the plan: the date shown is step 1's
  expect(shownStep(steps, 3)).toBe(2);
  expect(shownStep(steps, null)).toBeNull();
  expect(shownStep(steps, 1)).toBeNull(); // nothing before the first
  expect(shownStep([{ step: 1 }, { step: 4 }], 4)).toBe(1); // read from the plan's steps, not by subtracting one
});

const me = '0193b1c2-3d4e-7f80-9a1b-2c3d4e5f6a70';

it('says whose a lead is from its owner principal', () => {
  expect(ownerText(null, me)).toBe('No one');
  expect(ownerText({ kind: 'user', id: me, displayName: 'Me' }, me)).toBe('You');
  // Someone else by name, as the server answers the owner (RAD-109); without a name, someone else.
  expect(ownerText({ kind: 'user', id: '0193b1c2-3d4e-7f80-9a1b-2c3d4e5f6a71', displayName: 'Ravi Kumar' }, me)).toBe('Ravi Kumar');
  expect(ownerText({ kind: 'user', id: '0193b1c2-3d4e-7f80-9a1b-2c3d4e5f6a71', displayName: null }, me)).toBe('Someone else');
});

it('names a lead by its name, else by the digits its phone keeps', () => {
  expect(leadName('Asha', { masked: '••••••3210' })).toBe('Asha');
  expect(leadName(null, { masked: '••••••3210' })).toBe('Lead ending 3210');
  expect(leadName(null, '+919876543210')).toBe('Lead ending 3210');
  expect(leadName(null, { masked: '••••••' })).toBe('No name given');
});
