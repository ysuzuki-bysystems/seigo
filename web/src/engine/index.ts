import * as v from "valibot";

import type * as ty from "./types";

export type EngineState = {
  ready: boolean;
  fields: Record<string, null>;
  records: [index: number, data: unknown[]][];
  error?: unknown;
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
    type: v.literal("error"),
    error: v.unknown(),
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

export class Engine {
  worker: Worker;
  state: EngineState;
  implementations: Promise<string[]>;
  ready: boolean;

  constructor() {
    this.worker = new Worker(new URL("./index.worker.ts", import.meta.url), {
      type: "module",
    });
    this.state = {
      ready: true,
      fields: {},
      records: [],
    };

    const { promise, resolve: resolveImplementations } =
      Promise.withResolvers<string[]>();
    this.implementations = promise;
    this.ready = false;

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

        case "error":
          this.state = {
            ...this.state,
            ready: true,
            error: data.error,
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
          this.ready = true;
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
