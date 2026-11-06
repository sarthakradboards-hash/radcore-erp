export const f = (ctx: { tx: object }) => Reflect.get(ctx.tx, '_');
