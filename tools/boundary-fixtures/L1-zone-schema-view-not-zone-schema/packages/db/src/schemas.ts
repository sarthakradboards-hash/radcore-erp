export const radcore = { view: (name: string, columns: object) => ({ as: (q: unknown) => ({ name, columns, q }) }) };
