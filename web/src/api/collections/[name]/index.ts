export type CollectOpts = {
  name: string;
  since?: Date;
  tail?: boolean;
};

type EventSourceShape = Pick<
  globalThis.EventSource,
  "addEventListener" | "close"
>;

type CollectOptsInternal = CollectOpts & {
  origin?: typeof globalThis.origin;
  eventSourceClass?: new (url: URL) => EventSourceShape;
};

class EventSourceStream extends ReadableStream<string> {
  constructor(source: EventSourceShape, signal?: AbortSignal) {
    super({
      start(controller) {
        if (signal?.aborted) {
          controller.error(signal.reason);
        }
        signal?.addEventListener("abort", () =>
          controller.error(signal.reason),
        );

        source.addEventListener("error", () =>
          controller.error(new Error("Connection failure.")),
        );

        // FIXME Possible overflow...
        source.addEventListener("message", (event) =>
          controller.enqueue(event.data),
        );
        source.addEventListener("eof", () => controller.close());
      },
      cancel() {
        source.close();
      },
    });
  }
}

export function collect(
  opts: CollectOpts,
  signal?: AbortSignal,
): AsyncIterable<string>;

export async function* collect(
  opts: CollectOptsInternal,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const params = new URLSearchParams({});
  if (opts.tail) {
    params.append("tail", "true");
  }
  if (typeof opts.since !== "undefined") {
    params.append("since", opts.since.toISOString());
  }

  const base = new URL("/api/collections/", opts.origin ?? globalThis.origin);
  const url = new URL(opts.name, base);
  url.search = params.toString();

  const source = new (opts.eventSourceClass ?? globalThis.EventSource)(url);
  try {
    const stream = new EventSourceStream(source, signal);
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        yield value;
      }
    } finally {
      reader.releaseLock();
      await stream.cancel();
    }
  } finally {
    source.close();
  }
}

if (import.meta.vitest) {
  const { describe, it } = import.meta.vitest;

  describe("collect", () => {
    type DummyEventSourceNotify = {
      url?: URL | undefined;
      closed?: boolean;
    };

    function newDummyEventSource(
      notify: DummyEventSourceNotify,
      events: Event[],
    ): CollectOptsInternal["eventSourceClass"] {
      return class DummyEventSource
        extends EventTarget
        implements EventSourceShape
      {
        constructor(url: URL) {
          super();
          notify.url = url;

          queueMicrotask(() => {
            for (const event of events) {
              this.dispatchEvent(event);
            }
          });
        }

        addEventListener(
          type: string,
          callback: unknown,
          options?: AddEventListenerOptions,
        ): void {
          super.addEventListener(
            type,
            callback as EventListenerOrEventListenerObject,
            options,
          );
        }

        close() {
          notify.closed = true;
        }
      };
    }

    it("ok", async ({ expect }) => {
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 1000);

      const notify: DummyEventSourceNotify = {};
      const DummyEventSource = newDummyEventSource(notify, [
        new MessageEvent("message", { data: "a" }),
        new MessageEvent("message", { data: "b" }),
        new MessageEvent("message", { data: "c" }),
        new MessageEvent("eof", {}),
      ]);

      const opts: CollectOptsInternal = {
        name: "test",
        tail: true,
        since: new Date(0),

        origin: "http://example.com",
        eventSourceClass: DummyEventSource,
      };

      const recv: string[] = [];
      for await (const m of collect(opts, abort.signal)) {
        recv.push(m);
      }

      expect(notify.url?.href).toBe(
        "http://example.com/api/collections/test?tail=true&since=1970-01-01T00%3A00%3A00.000Z",
      );
      expect(notify.closed).toBe(true);
      expect(recv).toEqual(["a", "b", "c"]);
    });

    it("errored", async ({ expect }) => {
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 1000);

      const notify: DummyEventSourceNotify = {};
      const DummyEventSource = newDummyEventSource(notify, [
        new Event("error", {}),
      ]);

      const opts: CollectOptsInternal = {
        name: "test",
        tail: true,
        since: new Date(0),

        origin: "http://example.com",
        eventSourceClass: DummyEventSource,
      };

      const iter = collect(opts, abort.signal)[Symbol.asyncIterator]();
      await expect(iter.next()).rejects.toThrowError("Connection failure.");
    });

    it("aborted immediate", async ({ expect }) => {
      const abort = new AbortController();
      abort.abort();

      const notify: DummyEventSourceNotify = {};
      const DummyEventSource = newDummyEventSource(notify, []);

      const opts: CollectOptsInternal = {
        name: "test",
        tail: true,
        since: new Date(0),

        origin: "http://example.com",
        eventSourceClass: DummyEventSource,
      };

      const iter = collect(opts, abort.signal)[Symbol.asyncIterator]();
      await expect(iter.next()).rejects.toThrowError(
        "This operation was aborted",
      );
    });

    it("aborted", async ({ expect }) => {
      const abort = new AbortController();
      queueMicrotask(() => abort.abort());

      const notify: DummyEventSourceNotify = {};
      const DummyEventSource = newDummyEventSource(notify, []);

      const opts: CollectOptsInternal = {
        name: "test",
        tail: true,
        since: new Date(0),

        origin: "http://example.com",
        eventSourceClass: DummyEventSource,
      };

      const iter = collect(opts, abort.signal)[Symbol.asyncIterator]();
      await expect(iter.next()).rejects.toThrowError(
        "This operation was aborted",
      );
    });

    it("cancel", async ({ expect }) => {
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 1000);

      const notify: DummyEventSourceNotify = {};
      const DummyEventSource = newDummyEventSource(notify, [
        new MessageEvent("message", { data: "a" }),
      ]);

      const opts: CollectOptsInternal = {
        name: "test",
        tail: true,
        since: new Date(0),

        origin: "http://example.com",
        eventSourceClass: DummyEventSource,
      };

      const iter = collect(opts, abort.signal)[Symbol.asyncIterator]();
      await iter.next();
      await iter.return?.();
      expect(notify.closed).toBe(true);
    });
  });
}
