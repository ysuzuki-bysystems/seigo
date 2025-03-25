import * as v from "valibot";

import { collect } from "../api/collections/[name]/index.ts";
import type { CollectOpts } from "../api/collections/[name]/index.ts";
import type * as ty from "./types.ts";

type ImplementationModule = {
  readonly name: string;
  default: new () => ty.EngineImplementation;
};

type CollectOptsWithImpl = CollectOpts & { implementation: string };

type Env<E extends ty.Event = ty.Event> = {
  impls: Record<string, ImplementationModule>;
  collect: typeof collect;
  currentImpl?: [string, ty.EngineImplementation];
  lastStoredOpts?: CollectOptsWithImpl;
  processing?: Promise<void>;
  abort?: AbortController;
  post: (event: E) => void;
};

function equalOpts(
  l: CollectOptsWithImpl,
  r: CollectOptsWithImpl | undefined,
): boolean {
  if (typeof r === "undefined") {
    return false;
  }

  if (l.name !== r.name) {
    return false;
  }
  if (l.implementation !== r.implementation) {
    return false;
  }
  if (l.since?.getTime() !== r.since?.getTime()) {
    return false;
  }
  if (l.tail !== r.tail) {
    return false;
  }

  return true;
}

async function handleStartExecution(
  env: Env,
  req: ty.StartExecutionRequest,
): Promise<void> {
  while (typeof env.processing !== "undefined") {
    await env.processing;
  }

  const { promise, resolve } = Promise.withResolvers<void>();
  env.processing = promise;
  try {
    if (
      typeof env.currentImpl === "undefined" ||
      env.currentImpl[0] !== req.language
    ) {
      const impl = env.impls[req.language];
      if (typeof impl === "undefined") {
        throw new Error(`No such impl: ${req.language}`);
      }
      env.currentImpl = [req.language, new impl.default()];
    }

    const abort = new AbortController();
    env.abort = abort;
    try {
      const impl = env.currentImpl[1];

      env.post({
        type: "begin",
      });

      const opts: CollectOptsWithImpl = {
        name: req.collection,
        tail: req.tail,
        since: req.since,
        implementation: req.language,
      };

      const onRow = (row: object) => {
        abort.signal.throwIfAborted();
        env.post({ type: "row", row });
      };
      const onStderr = (chunk: string) => {
        env.post({ type: "stderr", chunk });
      };

      if (req.tail) {
        env.lastStoredOpts = undefined;
        await impl.collectEvaluate(
          env.collect(opts, abort.signal),
          req.query,
          false,
          onRow,
          onStderr,
        );
      } else if (req.refresh || !equalOpts(opts, env.lastStoredOpts)) {
        env.lastStoredOpts = opts;
        await impl.collectEvaluate(
          env.collect(opts, abort.signal),
          req.query,
          true,
          onRow,
          onStderr,
        );
      } else {
        await impl.evaluate(req.query, onRow, onStderr);
      }
    } finally {
      env.abort = undefined; // `undefined` ... Protected by lint/suspicious/noShadowRestrictedNames
      abort.abort();
    }
  } catch (e) {
    env.post({
      type: "stderr",
      chunk: String(e),
    });
    throw e;
  } finally {
    env.post({ type: "done" });
    resolve();
    env.processing = undefined;
  }
}

function handleCancel(env: Env<ty.RowEvent>, _: ty.CancelRequest) {
  env.abort?.abort();
}

async function handle(env: Env, req: ty.Request): Promise<void> {
  switch (req.type) {
    case "start":
      return await handleStartExecution(env, req);

    case "cancel":
      return handleCancel(env, req);

    default:
      req satisfies never;
      break;
  }
}

const Request: v.GenericSchema<ty.Request> = v.union([
  v.intersect([
    v.object({
      type: v.literal("start"),
      collection: v.string(),
      language: v.string(),
      query: v.string(),
      refresh: v.optional(v.literal(true)),
    }),
    v.union([
      v.object({
        tail: v.literal(true),
        since: v.optional(v.undefined()),
      }),
      v.object({
        tail: v.optional(v.literal(false)),
        since: v.optional(v.date()),
      }),
    ]),
  ]),
  v.object({
    type: v.literal("cancel"),
  }),
]);

function assertsRequest(val: unknown): asserts val is ty.Request {
  v.parse(Request, val);
}

type Global = {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: "message",
    handler: (event: MessageEvent) => void,
  ) => void;
};

function _start(
  global: Global,
  impls: Record<string, ImplementationModule>,
  collect_: typeof collect,
  logger: (v: unknown) => void,
) {
  const env: Env = {
    impls,
    collect: collect_,
    post: (event) => global.postMessage(event),
  };

  function handleMessage(event: MessageEvent): void {
    const req = event.data;
    assertsRequest(req);

    handle(env, req).catch(logger);
  }

  global.addEventListener("message", handleMessage);

  env.post({
    type: "ready",
    implementations: Object.keys(impls),
  });
}

if (
  typeof DedicatedWorkerGlobalScope !== "undefined" &&
  globalThis instanceof DedicatedWorkerGlobalScope
) {
  const impls: Record<string, ImplementationModule> = {};

  function register(impl: ImplementationModule): void {
    impls[impl.name] = impl;
  }

  register(await import("./jaq/worker.ts"));
  register(await import("./plain/worker.ts"));

  _start(globalThis, impls, collect, console.error);
}

if (import.meta.vitest) {
  /* v8 ignore start */
  const { it, describe, expect } = import.meta.vitest;

  describe("assertsRequest", () => {
    const cases: ty.Request[] = [
      {
        type: "cancel",
      },
      {
        type: "start",
        collection: "c",
        language: "l",
        query: "q",
      },
      {
        type: "start",
        collection: "c",
        language: "l",
        query: "q",
        tail: true,
      },
      {
        type: "start",
        collection: "c",
        language: "l",
        query: "q",
        tail: false,
        since: new Date(0),
      },
    ];
    it.each(cases.map<[string, ty.Request]>((v) => [JSON.stringify(v), v]))(
      "%s",
      (_, obj) => {
        assertsRequest(obj);
      },
    );
  });

  describe("equalOpts", () => {
    type Test = [
      name: string,
      l: CollectOptsWithImpl,
      r: CollectOptsWithImpl | undefined,
      wants: boolean,
    ];
    it.each<Test>([
      [
        "same",
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        true,
      ],
      [
        "no r",
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        undefined,
        false,
      ],
      [
        "l.name != r.name",
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        {
          name: "test1",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        false,
      ],
      [
        "l.implementation != r.implementation",
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        {
          name: "test",
          implementation: "impl1",
          since: new Date(0),
          tail: false,
        },
        false,
      ],
      [
        "l.since != r.since",
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        {
          name: "test",
          implementation: "impl",
          since: new Date(1),
          tail: false,
        },
        false,
      ],
      [
        "l.tail != r.tail",
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: false,
        },
        {
          name: "test",
          implementation: "impl",
          since: new Date(0),
          tail: true,
        },
        false,
      ],
    ])("%s", (_, l, r, wants) => {
      expect(equalOpts(l, r)).toBe(wants);
    });
  });

  describe("worker", () => {
    it("ok", async ({ expect }) => {
      const { readable, writable } = new TransformStream<unknown, unknown>();
      const writer = writable.getWriter();
      const target = new EventTarget();
      const global: Global = {
        postMessage(message) {
          writer.write(message);
        },
        addEventListener(type, handler) {
          target.addEventListener(type, handler as EventListener);
        },
      };
      const impls: Record<string, ImplementationModule> = {
        test: {
          name: "test",
          default: class implements ty.EngineImplementation {
            async evaluate(
              query: string,
              onRow: ty.OnRow,
              onStderr: ty.OnStderr,
            ): Promise<void> {
              await Promise.resolve();

              onRow({ method: "evaluate", row: 1, query });
              onRow({ method: "evaluate", row: 2, query });
              onRow({ method: "evaluate", row: 3, query });
              onStderr("ok");
            }
            async collectEvaluate(
              collection: AsyncIterable<string>,
              query: string,
              _store: boolean,
              onRow: ty.OnRow,
              onStderr: ty.OnStderr,
            ): Promise<void> {
              await Promise.resolve();

              for await (const row of collection) {
                onRow({
                  method: "collectEvaluate",
                  row: JSON.parse(row),
                  query,
                });
              }
              onStderr("ok");
            }
          },
        },
      };
      async function* collect() {
        await Promise.resolve();
        yield `{"hello":"world"}`;
      }
      _start(global, impls, collect, () => {
        /* nop */
      });

      const reader = readable.getReader();
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "ready",
          implementations: ["test"],
        },
      });

      target.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "start",
            collection: "default",
            language: "test",
            query: ".",
            tail: true,
          } satisfies ty.StartExecutionRequest,
        }),
      );

      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "begin",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "row",
          row: {
            method: "collectEvaluate",
            query: ".",
            row: {
              hello: "world",
            },
          },
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "stderr",
          chunk: "ok",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "done",
        },
      });

      target.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "start",
            collection: "default",
            language: "test",
            query: ".",
          } satisfies ty.StartExecutionRequest,
        }),
      );
      // queuing.
      target.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "start",
            collection: "default",
            language: "test",
            query: ".",
          } satisfies ty.StartExecutionRequest,
        }),
      );

      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "begin",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "row",
          row: {
            method: "collectEvaluate",
            query: ".",
            row: {
              hello: "world",
            },
          },
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "stderr",
          chunk: "ok",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "done",
        },
      });

      // queued.

      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "begin",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "row",
          row: {
            method: "evaluate",
            query: ".",
            row: 1,
          },
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "row",
          row: {
            method: "evaluate",
            query: ".",
            row: 2,
          },
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "row",
          row: {
            method: "evaluate",
            query: ".",
            row: 3,
          },
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "stderr",
          chunk: "ok",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "done",
        },
      });

      target.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "start",
            collection: "default",
            language: "test",
            query: ".",
          } satisfies ty.StartExecutionRequest,
        }),
      );
      target.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "cancel",
          } satisfies ty.CancelRequest,
        }),
      );

      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "begin",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "stderr",
          chunk: "AbortError: This operation was aborted",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "done",
        },
      });

      target.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "start",
            collection: "default",
            language: "unknown",
            query: ".",
          } satisfies ty.StartExecutionRequest,
        }),
      );

      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "stderr",
          chunk: "Error: No such impl: unknown",
        },
      });
      await expect(reader.read()).resolves.toEqual({
        done: false,
        value: {
          type: "done",
        },
      });
    });
  });
}
