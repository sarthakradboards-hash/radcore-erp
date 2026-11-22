// A quick bill's card rule (M3-11, RAD-115; Sarthak's answer and the architect's ruling), apart from the database so
// it's unit- and mutation-tested: a card payment keeps only the machine's approval code, and never card digits, even
// when someone types the card number into the code's field.

/** Whether `text` reads as a card number: 13 to 19 digits once spaces and dashes are dropped, passing the Luhn check. */
export function looksLikeCardNumber(text: string): boolean {
  const digits = text.replace(/[\s-]/g, '');
  if (!/^[0-9]{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (const [i, ch] of [...digits].toReversed().entries()) {
    const d = Number(ch) * (i % 2 === 1 ? 2 : 1);
    sum += d > 9 ? d - 9 : d;
  }
  return sum % 10 === 0;
}
