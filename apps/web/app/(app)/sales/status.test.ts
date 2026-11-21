import { expect, it } from 'vitest';
import { deliverySteps, invoiceSteps, orderSteps, quoteSteps, returnSteps } from './status.ts';

const keys = (steps: { key: string }[]) => steps.map((s) => s.key);

it('draws the usual path for a status on it', () => {
  expect(keys(quoteSteps('sent'))).toEqual(['draft', 'sent', 'accepted']);
  expect(keys(orderSteps('confirmed'))).toEqual(['draft', 'confirmed', 'closed']);
});

it('ends the path where a quote or an order stopped, when it left the usual path', () => {
  expect(keys(quoteSteps('declined'))).toEqual(['draft', 'sent', 'declined']);
  expect(keys(quoteSteps('expired'))).toEqual(['draft', 'sent', 'expired']);
  expect(keys(orderSteps('cancelled'))).toEqual(['draft', 'confirmed', 'cancelled']);
  expect(orderSteps('cancelled').at(-1)?.label).toBe('Cancelled');
});

it('runs an invoice from draft to posted, and on to cancelled once it was cancelled', () => {
  expect(keys(invoiceSteps('draft'))).toEqual(['draft', 'posted']);
  expect(keys(invoiceSteps('posted'))).toEqual(['draft', 'posted']);
  expect(keys(invoiceSteps('cancelled'))).toEqual(['draft', 'posted', 'cancelled']);
});

it('runs a delivery or a return the same way, on to Cancelled once it was cancelled', () => {
  expect(keys(deliverySteps('posted'))).toEqual(['draft', 'posted']);
  expect(keys(deliverySteps('cancelled'))).toEqual(['draft', 'posted', 'cancelled']);
  expect(keys(returnSteps('cancelled'))).toEqual(['draft', 'posted', 'cancelled']);
});
