import * as v from "valibot";

import { collect } from "../api";
import type { CollectOpts } from "../api";
import type * as ty from "./types";

type ImplementationModule = {
  readonly name: string;
  default: new () => ty.EngineImplementation;
};

const impls: Record<string, ImplementationModule> = {};

function register(impl: ImplementationModule): void {
  impls[impl.name] = impl;
}

register(await import("./plain/worker"));

type CollectOptsWithImpl = CollectOpts & { implementation: string };

type Env<E extends ty.Event = ty.Event> = {
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
      const impl = impls[req.language];
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

      let iter: AsyncIterable<object>;
      if (req.tail) {
        iter = impl.collectEvaluate(
          collect(opts, abort.signal),
          req.query,
          false,
        );
        env.lastStoredOpts = undefined;
      } else if (req.refresh || !equalOpts(opts, env.lastStoredOpts)) {
        iter = impl.collectEvaluate(
          collect(opts, abort.signal),
          req.query,
          true,
        );
        env.lastStoredOpts = opts;
      } else {
        iter = impl.evaluate(req.query);
      }

      for await (const obj of iter) {
        abort.signal.throwIfAborted();
        env.post({ type: "row", row: obj });
      }

      env.post({
        type: "done",
      });
    } finally {
      env.abort = undefined; // `undefined` ... Protected by lint/suspicious/noShadowRestrictedNames
      abort.abort();
    }
  } catch (e) {
    env.post({
      type: "error",
      error: e,
    });
    throw e;
  } finally {
    resolve();
    env.processing = undefined;
  }
}

async function handleCancel(
  env: Env<ty.RowEvent>,
  _: ty.CancelRequest,
): Promise<void> {
  await Promise.resolve();

  env.abort?.abort();
}

async function handle(env: Env, req: ty.Request): Promise<void> {
  switch (req.type) {
    case "start":
      return await handleStartExecution(env, req);

    case "cancel":
      return await handleCancel(env, req);

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

function _start() {
  const env: Env = {
    post: (event) => globalThis.postMessage(event),
  };

  function handleMessage(event: MessageEvent): void {
    const req = event.data;
    assertsRequest(req);

    handle(env, req).catch(console.error);
  }

  globalThis.addEventListener("message", handleMessage);

  env.post({
    type: "ready",
    implementations: Object.keys(impls),
  });
}

if (
  typeof DedicatedWorkerGlobalScope !== "undefined" &&
  globalThis instanceof DedicatedWorkerGlobalScope
) {
  _start();
}

if (import.meta.vitest) {
  const { it, describe } = import.meta.vitest;

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
}
