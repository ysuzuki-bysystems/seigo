import type * as ty from "../types";

export const name = "plain";

export default class PlainEngine implements ty.EngineImplementation {
  data: string[] = [];

  async *evaluate(_: string): AsyncIterable<object> {
    await Promise.resolve();

    for (const text of this.data) {
      yield JSON.parse(text);
    }
  }

  async *collectEvaluate(
    collection: AsyncIterable<string>,
    _: string,
    store: boolean,
  ): AsyncIterable<object> {
    this.data = [];
    for await (const row of collection) {
      if (store) {
        this.data.push(row);
      }

      yield JSON.parse(row);
    }
  }
}
