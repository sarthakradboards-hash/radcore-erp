// RAD-110 (M3-06): a quick reply's placeholders, filled for a lead, without a database.
import { describe, expect, it } from 'vitest';
import { fillReply } from './reply-rules.ts';

describe('fillReply', () => {
  it('fills the name, the first name and the owner', () => {
    expect(fillReply('Hi {first_name}, {owner} here about {name}’s enquiry', { name: 'Kiran  Rao', owner: 'Asha' }))
      .toBe('Hi Kiran, Asha here about Kiran  Rao’s enquiry');
  });
  it('fills every use of a placeholder', () => {
    expect(fillReply('{first_name}! {first_name}?', { name: 'Kiran', owner: null })).toBe('Kiran! Kiran?');
  });
  it('leaves out one with nothing to fill it, with the space before it', () => {
    expect(fillReply('Hi {first_name}, thanks', { name: null, owner: null })).toBe('Hi, thanks');
    expect(fillReply('Hi {name}. {owner} will call', { name: '  ', owner: null })).toBe('Hi. will call');
    expect(fillReply('{owner}', { name: 'Kiran', owner: '' })).toBe('');
  });
  it('trims a name and an owner, and keeps anything else in braces as written', () => {
    expect(fillReply('Hi {first_name} from {owner} {team}', { name: ' Kiran Rao ', owner: ' Asha ' })).toBe('Hi Kiran from Asha {team}');
  });
  it('never reads a filled value as a placeholder (auditor-2 on #303)', () => {
    expect(fillReply('Hi {name} from {owner}', { name: '{owner}', owner: 'Asha' })).toBe('Hi {owner} from Asha');
    expect(fillReply('{owner}: {name}', { name: 'Kiran', owner: '{name}' })).toBe('{name}: Kiran');
  });
});
