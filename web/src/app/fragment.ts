export type State = {
  collection: string;
  language: string;
  query: string;
};

const toSafePattern = /\+|\/|=+$/g;
function b64ToSafe(unsafe: string): string {
  return unsafe.replace(toSafePattern, (part) => {
    switch (part) {
      case "+":
        return "-";
      case "/":
        return "_";
      default:
        return ""; // =$ or ==$
    }
  });
}

const fromSafePattern = /-|_/g;
function b64FromSafe(safe: string): string {
  let padding: string;
  switch (safe.length % 4) {
    case 0:
      padding = "";
      break;
    case 2:
      padding = "==";
      break;
    case 3:
      padding = "=";
      break;
    default:
      throw new Error("May be invalid string.");
  }
  return (
    safe.replace(fromSafePattern, (part) => {
      switch (part) {
        case "-":
          return "+";
        case "_":
          return "/";
        default:
          throw new Error(`Unexpected match: ${part}`);
      }
    }) + padding
  );
}

async function compress(plain: string): Promise<string> {
  const readable = new Blob([plain])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  const blob = await new Response(readable).blob();

  const r = new FileReader();
  r.readAsDataURL(blob);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  r.addEventListener("load", () => resolve());
  r.addEventListener("error", reject);
  await promise;

  const result = r.result;
  if (typeof result !== "string") {
    throw new Error(`Unexpected type ${typeof result}`);
  }

  const n = result.indexOf(",");
  if (n < 0) {
    throw new Error(`Unexpected format: ${result}`);
  }

  return b64ToSafe(result.slice(n + 1));
}

async function decompress(compressed: string): Promise<string> {
  const response = await fetch(
    new URL(`data:;base64,${b64FromSafe(compressed)}`),
  );
  if (response.body === null) {
    throw new Error("response.body === null");
  }

  const stream = response.body.pipeThrough(new DecompressionStream("deflate"));
  return await new Response(stream).text();
}

function tryParseComponents(
  url: string,
  base: URL,
): [pathname: string, searchParams: URLSearchParams] {
  try {
    const { pathname, searchParams } = new URL(url, base);
    return [pathname, searchParams];
  } catch (_) {
    return ["/", new URLSearchParams()];
  }
}

const pathPattern = /^\/(?<collection>[^/]*)\/(?<language>[^/]*)\/(?<query>.*)/;
async function parsePathname(
  pathname: string,
): Promise<[colllection: string, language: string, query: string]> {
  await Promise.resolve();

  const m = pathPattern.exec(pathname);
  if (m === null || typeof m.groups === "undefined") {
    return ["", "", ""];
  }
  const { collection, language, query } = m.groups;

  try {
    switch (query[0]) {
      case "0":
        return [collection, language, query.slice(1)];
      case "1":
        return [collection, language, await decompress(query.slice(1))];
      default:
        break;
    }
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: TODO logger
    console.warn(e);
  }
  return [collection, language, ""];
}

async function parse(href: string): Promise<State> {
  const url = new URL(href);
  const hash = url.hash.slice(1); // remove ^#

  if (!hash.startsWith("/")) {
    return {
      collection: "",
      language: "",
      query: "",
    };
  }

  const [pathname, _params] = tryParseComponents(hash, url);
  const [collection, language, query] = await parsePathname(pathname);

  return {
    collection,
    language,
    query,
  };
}

async function encode(state: State): Promise<string> {
  const { collection, language, query: plainQuery } = state;

  const query = await compress(plainQuery);
  const placeholder = "http://example.com/";
  const method = "1";
  const { pathname } = new URL(
    `/${collection}/${language}/${method}${query}`,
    placeholder,
  );

  const params = new URLSearchParams();
  const search = params.toString();

  if (search === "") {
    return `#${pathname}`;
  }
  return `#${pathname}?${search}`;
}

type GlobalShape = {
  addEventListener(
    type: "hashchange",
    listener: (event: HashChangeEvent) => void,
  ): void;
  location: {
    href: string;
    assign(href: URL | string): void;
  };
};

export class FragmentStore {
  #global: GlobalShape;
  #target: EventTarget;
  #ready: Promise<void>;
  #snapshot: State | undefined;
  #error: unknown | undefined;

  constructor();
  constructor(global: GlobalShape);
  constructor(global: GlobalShape = globalThis) {
    this.#global = global;
    this.subscribe = this.subscribe.bind(this);
    this.snapshot = this.snapshot.bind(this);
    this.set = this.set.bind(this);

    this.#target = new EventTarget();

    const { promise: ready, resolve: resolveReady } =
      Promise.withResolvers<void>();
    this.#ready = ready;

    (async (href) => {
      try {
        const state = await parse(href);
        this.#snapshot = state;
      } catch (e) {
        this.#error = e;
      } finally {
        resolveReady();
      }
    })(this.#global.location.href);

    this.#global.addEventListener("hashchange", (event) => {
      (async (href) => {
        try {
          const state = await parse(href);
          this.#snapshot = state;
        } catch (e) {
          this.#error = e;
        }
        this.#target.dispatchEvent(new Event("changed"));
      })(event.newURL);
    });
  }

  subscribe(onStoreChange: () => void): () => void {
    const abort = new AbortController();
    this.#target.addEventListener("changed", onStoreChange, {
      signal: abort.signal,
    });
    return () => abort.abort();
  }

  get ready(): Promise<void> {
    return this.#ready;
  }

  snapshot(): State {
    if (typeof this.#error !== "undefined") {
      throw this.#error;
    }

    if (typeof this.#snapshot === "undefined") {
      throw new Error("must await .ready");
    }
    return this.#snapshot;
  }

  set(state: State): void {
    (async () => {
      try {
        const hash = await encode(state);
        this.#global.location.assign(hash);
      } catch (e) {
        this.#error = e;
        this.#target.dispatchEvent(new Event("changed"));
      }
    })();
  }
}

if (import.meta.vitest) {
  /* v8 ignore start */
  const { describe, it, beforeAll, afterAll } = import.meta.vitest;

  beforeAll(async () => {
    const abort = new AbortController();
    const signal = abort.signal;

    // biome-ignore lint/correctness/noNodejsModules: testing
    const { Buffer } = await import("node:buffer");

    class FileReaderShim
      extends EventTarget
      implements Pick<FileReader, "readAsDataURL">
    {
      result: string | undefined;

      // biome-ignore lint/style/useNamingConvention: Known method
      readAsDataURL(blob: Blob): void {
        (async () => {
          const buf = await blob.arrayBuffer();
          const data = Buffer.from(buf).toString("base64");
          this.result = `data:;base64,${data}`;
          this.dispatchEvent(new Event("load"));
        })();
      }
    }

    Object.assign(globalThis, {
      // biome-ignore lint/style/useNamingConvention: Class name
      FileReader: FileReaderShim,
      __testCleanup: () => abort.abort(),
    });
    signal.addEventListener("abort", () => {
      Object.assign(globalThis, {
        // biome-ignore lint/style/useNamingConvention: Class name
        FileReader: undefined,
        __testCleanup: undefined,
      });
    });
  });

  afterAll(() => {
    (globalThis as unknown as { __testCleanup: () => void }).__testCleanup();
  });

  describe("b64XXSafe", () => {
    it("ok", async ({ expect }) => {
      // 0xd7, 0xed, 0x7e, 0xdb, 0xfd, 0xbf, 0xdf, 0x7d
      const val = "1+1+2/2/333=";
      const v1 = b64ToSafe(val);
      const v2 = b64FromSafe(v1);
      const r = await fetch(`data:;base64,${v2}`);
      await expect(r.bytes()).resolves.toEqual(
        Uint8Array.from([0xd7, 0xed, 0x7e, 0xdb, 0xfd, 0xbf, 0xdf, 0x7d]),
      );
    });
  });

  describe("gzip", () => {
    it("ok", async ({ expect }) => {
      const compressed = await compress("Hello, World!");
      const decompressed = await decompress(compressed);
      expect(decompressed).toBe("Hello, World!");
    });
  });

  describe("encode", () => {
    it("ok", async ({ expect }) => {
      const state: State = {
        collection: "default",
        language: "test",
        query: ".",
      };

      const frag = await encode(state);
      const parsed = await parse(new URL(frag, "http://example.com/").href);
      expect(parsed).toEqual(state);
    });
  });

  describe("FragmentStore", () => {
    it("ok", async ({ expect }) => {
      const target = new EventTarget();
      let location = "http://example.com/";
      const global: GlobalShape = {
        addEventListener(type, listener) {
          target.addEventListener(type, listener as EventListener);
        },
        location: {
          href: location,
          assign(href) {
            const old = location;
            location = new URL(href, old).href;

            const event = new Event("hashchange");
            Object.assign(event, {
              // biome-ignore lint/style/useNamingConvention: knwon name.
              newURL: location,
            });
            target.dispatchEvent(event);
          },
        },
      };

      const store = new FragmentStore(global);

      await store.ready;
      expect(store.snapshot()).toEqual({
        collection: "",
        language: "",
        query: "",
      });

      const { promise, resolve } = Promise.withResolvers<void>();
      const cancel = store.subscribe(resolve);
      store.set({
        collection: "default",
        language: "test",
        query: ".",
      });
      await promise;
      cancel();
      expect(store.snapshot()).toEqual({
        collection: "default",
        language: "test",
        query: ".",
      });
    });
  });
}
