import * as v from "valibot";

import type * as ty from "./types.ts";

type Series = {
  // Sparse Array
  data: Record<number, unknown>;
};

export type EngineState = {
  ready: boolean;
  series: Record<string, Series>;
  count: number;
  error?: string;
};

export function stateFields(state: EngineState): string[] {
  return Object.keys(state.series);
}

export function* stateRows(
  state: EngineState,
  select: string[],
): Iterable<[index: number, value: [key: string, val: unknown][]]> {
  const values = select.map<[string, Record<number, unknown> | undefined]>(
    (f) => [f, state.series[f]?.data],
  );
  for (let i = 0; i < state.count; i++) {
    const data = values.map<[string, unknown]>(([f, series]) => [
      f,
      series?.[i],
    ]);
    yield [i, data];
  }
}

type KeyOfUnion<T> = T extends T ? keyof T : never;
type DistributiveOmit<T, K extends KeyOfUnion<T>> = T extends T
  ? Omit<T, K>
  : never;

export type StartExecutionOpts = DistributiveOmit<
  ty.StartExecutionRequest,
  "type"
>;

const vEvent: v.GenericSchema<ty.Event> = v.union([
  v.object({
    type: v.literal("begin"),
  }),
  v.object({
    type: v.literal("done"),
  }),
  v.object({
    type: v.literal("stderr"),
    chunk: v.string(),
  }),
  v.object({
    type: v.literal("row"),
    row: v.unknown(),
  }),
  v.object({
    type: v.literal("ready"),
    implementations: v.array(v.string()),
  }),
]);

function assertsEvent(val: unknown): asserts val is ty.Event {
  v.parse(vEvent, val);
}

function addRowPrimitive(
  prev: EngineState,
  data: null | boolean | string | number,
): EngineState {
  const primitiveKey = "";

  const index = prev.count;
  const series: EngineState["series"] = {};

  series[primitiveKey] = {
    data: {
      ...prev.series[primitiveKey]?.data,
      [index]: data,
    },
  };

  return {
    ...prev,
    series: {
      ...prev.series,
      ...series,
    },
    count: prev.count + 1,
  };
}

function addRowList(prev: EngineState, data: unknown[]): EngineState {
  const index = prev.count;
  const series: EngineState["series"] = {};

  for (const [key, val] of Object.entries(data)) {
    series[key] = {
      data: {
        ...prev.series[key]?.data,
        [index]: val,
      },
    };
  }

  return {
    ...prev,
    series: {
      ...prev.series,
      ...series,
    },
    count: prev.count + 1,
  };
}

function addRowRecord(
  prev: EngineState,
  data: Record<string, unknown>,
): EngineState {
  const index = prev.count;
  const series: EngineState["series"] = {};

  for (const [key, val] of Object.entries(data)) {
    series[key] = {
      data: {
        ...prev.series[key]?.data,
        [index]: val,
      },
    };
  }

  return {
    ...prev,
    series: {
      ...prev.series,
      ...series,
    },
    count: prev.count + 1,
  };
}

function addRow(state: EngineState, data: unknown): EngineState {
  if (data === null) {
    return addRowPrimitive(state, data);
  }
  if (typeof data === "boolean") {
    return addRowPrimitive(state, data);
  }
  if (typeof data === "string") {
    return addRowPrimitive(state, data);
  }
  if (typeof data === "number") {
    return addRowPrimitive(state, data);
  }

  if (Array.isArray(data)) {
    return addRowList(state, data);
  }

  return addRowRecord(state, data as Record<string, unknown>);
}

type WorkerShape = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
    options?: AddEventListenerOptions,
  ): void;
  postMessage(message: unknown): void;
};

type NewWorker = () => WorkerShape;

function defaultNewWorker(): Worker {
  return new Worker(new URL("./index.worker.ts", import.meta.url), {
    type: "module",
  });
}

export class Engine {
  worker: WorkerShape;
  state: EngineState;
  implementations: Promise<string[]>;

  constructor();
  constructor(newWorker: NewWorker);
  constructor(newWorker: NewWorker = defaultNewWorker) {
    this.worker = newWorker();
    this.state = {
      ready: true,
      series: {},
      count: 0,
    };

    const { promise, resolve: resolveImplementations } =
      Promise.withResolvers<string[]>();
    this.implementations = promise;

    this.snapshot = this.snapshot.bind(this);
    this.subscribe = this.subscribe.bind(this);

    this.worker.addEventListener("message", (event) => {
      const data = event.data;
      assertsEvent(data);

      switch (data.type) {
        case "begin":
          this.state = {
            ready: false,
            series: {},
            count: 0,
            error: undefined,
          };
          break;

        case "stderr":
          this.state = {
            ...this.state,
            error: (this.state.error ?? "") + data.chunk,
          };
          break;

        case "done":
          this.state = {
            ...this.state,
            ready: true,
          };
          break;

        case "row": {
          this.state = addRow(this.state, data.row);
          break;
        }

        case "ready": {
          resolveImplementations(data.implementations);
          break;
        }

        default: {
          data satisfies never;
          throw new Error("never");
        }
      }
    });
  }

  snapshot(): EngineState {
    return this.state;
  }

  subscribe(onStoreChange: () => void): () => void {
    const abort = new AbortController();
    this.worker.addEventListener("message", onStoreChange, {
      signal: abort.signal,
    });
    return () => abort.abort();
  }

  startExecution(opts: StartExecutionOpts): void {
    const req: ty.StartExecutionRequest = {
      type: "start",
      ...opts,
    };
    this.worker.postMessage(req);
  }

  cancel(): void {
    const req: ty.CancelRequest = {
      type: "cancel",
    };
    this.worker.postMessage(req);
  }
}

if (import.meta.vitest) {
  /* v8 ignore start */
  const { describe, it } = import.meta.vitest;

  describe("addRow", () => {
    it("ok", ({ expect }) => {
      let state: EngineState = {
        ready: true,
        series: {},
        count: 0,
      };

      state = addRow(state, { k1: "v1", k2: "v2" });
      expect(state).toEqual<EngineState>({
        ready: true,
        series: {
          k1: {
            data: {
              0: "v1",
            },
          },
          k2: {
            data: {
              0: "v2",
            },
          },
        },
        count: 1,
      });

      state = addRow(state, []);
      expect(state).toEqual<EngineState>({
        ready: true,
        series: {
          k1: {
            data: {
              0: "v1",
            },
          },
          k2: {
            data: {
              0: "v2",
            },
          },
        },
        count: 2,
      });

      state = addRow(state, ["el1", "el2"]);
      expect(state).toEqual<EngineState>({
        ready: true,
        series: {
          k1: {
            data: {
              0: "v1",
            },
          },
          k2: {
            data: {
              0: "v2",
            },
          },
          "0": {
            data: {
              2: "el1",
            },
          },
          "1": {
            data: {
              2: "el2",
            },
          },
        },
        count: 3,
      });

      state = addRow(state, null);
      expect(state).toEqual<EngineState>({
        ready: true,
        series: {
          k1: {
            data: {
              0: "v1",
            },
          },
          k2: {
            data: {
              0: "v2",
            },
          },
          "0": {
            data: {
              2: "el1",
            },
          },
          "1": {
            data: {
              2: "el2",
            },
          },
          "": {
            data: {
              3: null,
            },
          },
        },
        count: 4,
      });

      const fields = stateFields(state);
      expect(fields).toEqual(["0", "1", "k1", "k2", ""]);
      expect(Array.from(stateRows(state, fields))).toEqual([
        [
          0,
          [
            ["0", undefined],
            ["1", undefined],
            ["k1", "v1"],
            ["k2", "v2"],
            ["", undefined],
          ],
        ],
        [
          1,
          [
            ["0", undefined],
            ["1", undefined],
            ["k1", undefined],
            ["k2", undefined],
            ["", undefined],
          ],
        ],
        [
          2,
          [
            ["0", "el1"],
            ["1", "el2"],
            ["k1", undefined],
            ["k2", undefined],
            ["", undefined],
          ],
        ],
        [
          3,
          [
            ["0", undefined],
            ["1", undefined],
            ["k1", undefined],
            ["k2", undefined],
            ["", null],
          ],
        ],
      ]);
    });
  });

  describe("Engine", () => {
    it("ok", async ({ expect }) => {
      const target = new EventTarget();
      function newWorker(): WorkerShape {
        queueMicrotask(() => {
          target.dispatchEvent(
            new MessageEvent<ty.Event>("message", {
              data: {
                type: "ready",
                implementations: ["test"],
              },
            }),
          );
        });
        return {
          postMessage(message) {
            if (message === null || typeof message !== "object") {
              throw new Error("Unexpected");
            }

            const { type } = message as Record<string, unknown>;
            switch (type) {
              case "start": {
                const events: ty.Event[] = [
                  { type: "begin" },
                  { type: "row", row: { row: 1 } },
                  { type: "row", row: { row: 2 } },
                  { type: "row", row: { row2: 3 } },
                  { type: "stderr", chunk: "Hello" },
                  { type: "done" },
                ];

                for (const event of events) {
                  target.dispatchEvent(
                    new MessageEvent("message", { data: event }),
                  );
                }
                break;
              }
              case "cancel": {
                break;
              }
              default:
                throw new Error(`Unknown: ${type}`);
            }
          },
          addEventListener(type, listener, options) {
            target.addEventListener(type, listener as EventListener, options);
          },
        };
      }
      const engine = new Engine(newWorker);

      await expect(engine.implementations).resolves.toEqual(["test"]);

      const history: EngineState[] = [];
      engine.subscribe(() => {
        history.push(engine.snapshot());
      });

      expect(history).toEqual([]);

      engine.startExecution({
        collection: "default",
        language: "test",
        query: ".",
      });

      expect(history).toEqual<EngineState[]>([
        {
          ready: false,
          series: {},
          count: 0,
          error: undefined,
        },
        {
          ready: false,
          series: {
            row: {
              data: { 0: 1 },
            },
          },
          count: 1,
          error: undefined,
        },
        {
          ready: false,
          series: {
            row: {
              data: {
                0: 1,
                1: 2,
              },
            },
          },
          count: 2,
          error: undefined,
        },
        {
          ready: false,
          series: {
            row: {
              data: {
                0: 1,
                1: 2,
              },
            },
            row2: {
              data: {
                2: 3,
              },
            },
          },
          count: 3,
          error: undefined,
        },
        {
          ready: false,
          series: {
            row: {
              data: {
                0: 1,
                1: 2,
              },
            },
            row2: {
              data: {
                2: 3,
              },
            },
          },
          count: 3,
          error: "Hello",
        },
        {
          ready: true,
          series: {
            row: {
              data: {
                0: 1,
                1: 2,
              },
            },
            row2: {
              data: {
                2: 3,
              },
            },
          },
          count: 3,
          error: "Hello",
        },
      ]);

      history.splice(0);
      engine.cancel();
      expect(history).toEqual([]);
    });
  });
}
