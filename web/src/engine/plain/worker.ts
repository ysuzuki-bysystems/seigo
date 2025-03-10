import type * as ty from "../types.ts";

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

if (import.meta.vitest) {
  /* v8 ignore start */
  const { describe, it } = import.meta.vitest;

  describe("PlainEngine", () => {
    it("store", async ({ expect }) => {
      async function* collection() {
        await Promise.resolve();

        yield JSON.stringify({ hello: "world!" });
        yield JSON.stringify({ hello: "world2!" });
      }

      const engine = new PlainEngine();

      const rows: unknown[] = [];
      await engine.collectEvaluate(collection(), "", true, (row) =>
        rows.push(row),
      );
      expect(rows).toEqual([{ hello: "world!" }, { hello: "world2!" }]);

      rows.splice(0);
      engine.evaluate("", (row) => rows.push(row));
      expect(rows).toEqual([{ hello: "world!" }, { hello: "world2!" }]);
    });
  });
}
