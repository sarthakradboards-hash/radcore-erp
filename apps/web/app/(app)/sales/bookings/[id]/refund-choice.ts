// What a refund choice sends (RAD-127): none sends no refund (the advance stays as the customer's credit), all sends what the
// server says is left, and part sends the amount typed. The server checks the amount against what is left.
export type Choice = 'full' | 'part' | 'none';

export const refundFor = (choice: Choice, left: string, amount: string, accountId: string): { amount: string; accountId: string } | undefined =>
  choice === 'none' ? undefined : { amount: choice === 'full' ? left : amount, accountId };
