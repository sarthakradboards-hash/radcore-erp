/** The gallery's view choices: read by the page on the server and switched by lists.tsx in the browser. */
export const VIEWS = ['list', 'board'] as const;
export type View = (typeof VIEWS)[number];
