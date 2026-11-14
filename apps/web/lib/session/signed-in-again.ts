// RAD-50 (auditor on RAD-55): after signing in again in the signed-out dialog, is it the same person? Only then may
// the page, its cached data and what was typed stay. Anyone else, or a person we can't tell, gets a full page load.
export type AfterSignIn = 'keep' | 'reload';

export function afterSignInAgain(before: string | undefined, after: string): AfterSignIn {
  return before !== undefined && before === after ? 'keep' : 'reload';
}
