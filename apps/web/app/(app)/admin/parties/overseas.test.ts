import { expect, it } from 'vitest';
import { overseasChange } from './overseas.ts';

const registered = { gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', composition: false, stateCode: '27' };

it('clears the tax boxes on a tick and puts them back on the untick', () => {
  const ticked = overseasChange(true, registered, null);
  expect(ticked.set).toEqual({ gstin: '', pan: '', composition: false, stateCode: '96' });
  const unticked = overseasChange(false, ticked.set, ticked.kept);
  expect(unticked.set).toEqual(registered);
  expect(unticked.kept).toBeNull();
});

it('asks for the state when a saved overseas party is unticked', () => {
  const saved = { gstin: '', pan: '', composition: false, stateCode: '96' };
  expect(overseasChange(false, saved, null).set).toEqual({ ...saved, stateCode: '' });
});
