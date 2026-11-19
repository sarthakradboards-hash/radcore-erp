/** The items list's view choices, read on the server (page.tsx) and switched in the browser (items.tsx). */
export const ITEM_VIEWS = ['list', 'cards'] as const;
export type ItemView = (typeof ITEM_VIEWS)[number];
