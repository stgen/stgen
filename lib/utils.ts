export type Select<T, key extends keyof T> = T extends { [K in key]: infer TReturn }
  ? TReturn
  : never;

export type ValueOf<T extends { [K in key]: { value: unknown } }, key extends keyof T> = Select<
  Select<T, key>,
  'value'
>;

export type StatusType<T extends { getStatus: () => Promise<unknown> }> = T extends {
  getStatus: () => Promise<infer TResult>;
}
  ? TResult
  : never;
