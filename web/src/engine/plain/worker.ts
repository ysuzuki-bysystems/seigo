import type * as ty from "../types";

export const name = "plain";

export default class PlainEngine implements ty.EngineImplementation {
  data: string[] = [];

  evaluate(_: string, onRow: ty.OnRow): void {
    for (const text of this.data) {
      onRow(JSON.parse(text));
    }
  }

  async collectEvaluate(
    collection: AsyncIterable<string>,
    _: string,
    store: boolean,
    onRow: ty.OnRow,
  ): Promise<void> {
    this.data = [];
    for await (const row of collection) {
      if (store) {
        this.data.push(row);
      }

      onRow(JSON.parse(row));
    }
  }
}
