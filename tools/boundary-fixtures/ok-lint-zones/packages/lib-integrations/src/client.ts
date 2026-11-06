type Deps = { fetch: (url: string) => Promise<unknown> };
export const fromDeps = (deps: Deps) => {
  const { fetch } = deps;
  return fetch;
};
export function client({ fetch }: Deps) {
  return fetch;
}
export const fromCtx = (ctx: { outbound: Deps }) => {
  const { fetch } = ctx.outbound;
  return fetch;
};
