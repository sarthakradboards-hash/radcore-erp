export const byTotal = (a: { total: string }, b: { total: string }) => (a.total < b.total ? -1 : 1);
