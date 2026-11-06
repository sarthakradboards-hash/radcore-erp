export const f = (ctx: { tx: object }) => {
  // @ts-expect-error
  return ctx.tx.query;
};
