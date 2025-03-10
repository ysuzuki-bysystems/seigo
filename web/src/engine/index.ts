import * as v from "valibot";

import type * as ty from "./types.ts";

export type EngineState = {
  ready: boolean;
  fields: Record<string, null>;
  records: [index: number, data: unknown[]][];
  error?: string;
};

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
    row: v.record(v.string(), v.unknown()),
  }),
  v.object({
    type: v.literal("ready"),
    implementations: v.array(v.string()),
  }),
]);

function assertsEvent(val: unknown): asserts val is ty.Event {
  v.parse(vEvent, val);
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
      fields: {},
      records: [],
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
            fields: {},
            records: [],
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
          const fields = {
            ...this.state.fields,
          };
          for (const [key] of Object.entries(data.row)) {
            if (key in fields) {
              continue;
            }

            fields[key] = null;
          }

          const row: unknown[] = [];
          for (const [key] of Object.entries(fields)) {
            row.push((data.row as Record<string, unknown>)[key]);
          }

          this.state = {
            ...this.state,
            fields,
            records: [...this.state.records, [this.state.records.length, row]],
          };
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
          fields: {},
          records: [],
          error: undefined,
        },
        {
          ready: false,
          fields: {
            row: null,
          },
          records: [[0, [1]]],
          error: undefined,
        },
        {
          ready: false,
          fields: {
            row: null,
          },
          records: [
            [0, [1]],
            [1, [2]],
          ],
          error: undefined,
        },
        {
          ready: false,
          fields: {
            row: null,
            row2: null,
          },
          records: [
            [0, [1]],
            [1, [2]],
            [2, [undefined, 3]],
          ],
          error: undefined,
        },
        {
          ready: false,
          fields: {
            row: null,
            row2: null,
          },
          records: [
            [0, [1]],
            [1, [2]],
            [2, [undefined, 3]],
          ],
          error: "Hello",
        },
        {
          ready: true,
          fields: {
            row: null,
            row2: null,
          },
          records: [
            [0, [1]],
            [1, [2]],
            [2, [undefined, 3]],
          ],
          error: "Hello",
        },
      ]);

      history.splice(0);
      engine.cancel();
      expect(history).toEqual([]);
    });
  });
}
