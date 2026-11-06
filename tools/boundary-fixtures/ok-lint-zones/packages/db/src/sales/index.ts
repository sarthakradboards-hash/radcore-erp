export class PgColumn<V> {
  readonly value?: V;
}
type Config = { columns: Record<string, PgColumn<unknown>> };
export class PgTable<T extends Config> {
  declare readonly _: T;
  declare readonly $inferSelect: InferSelectModel<PgTable<T>>;
}
export type InferSelectModel<TTable extends PgTable<Config>> = {
  [K in keyof TTable['_']['columns']]: TTable['_']['columns'][K] extends PgColumn<infer V> ? V : never;
};
export const invoices = new PgTable<{ columns: { id: PgColumn<string>; total: PgColumn<string> } }>();
export type Invoice = InferSelectModel<typeof invoices>;
