import type * as ty from "../types.ts";
import { Wasip1 } from "./wasi.ts";
import type { Instantiate, Read, Write } from "./wasi.ts";

export const name = "jaq";

let modulePromise: Promise<WebAssembly.Module> | undefined;

async function newInstantiate(): Promise<Instantiate> {
  if (typeof modulePromise === "undefined") {
    modulePromise = WebAssembly.compileStreaming(
      fetch(new URL("./bin/jaq.wasm", import.meta.url)),
    );
  }
  const module = await modulePromise;

  return (imports) => WebAssembly.instantiate(module, imports);
}

function blobRead(input: Blob): Read {
  const reader = new FileReaderSync();
  let data = input;

  return (buf) => {
    const n = Math.min(data.size, buf.length);
    const src = reader.readAsArrayBuffer(data.slice(0, n));
    buf.set(new Uint8Array(src));
    data = data.slice(n);
    return n;
  };
}

type Flush = () => void;

function onRowWrite(onRow: ty.OnRow): [write: Write, flush: Flush] {
  const decoder = new TextDecoder();
  let data = "";

  const write: Write = (buf) => {
    data += decoder.decode(buf, { stream: true });
    while (data.length > 0) {
      const n = data.indexOf("\n");
      if (n < 0) {
        break;
      }

      const row = data.slice(0, n);
      data = data.slice(n + 1);
      onRow(JSON.parse(row));
    }

    return buf.length;
  };

  const flush: Flush = () => {
    if (data.length === 0) {
      return;
    }

    const row = data;
    data = "";
    onRow(JSON.parse(row));
  };

  return [write, flush];
}

function onStderrWrite(onStderr: ty.OnStderr): Write {
  const decoder = new TextDecoder();

  return (buf: Uint8Array): number => {
    onStderr(decoder.decode(buf, { stream: true }));
    return buf.length;
  };
}

type Run = (input: Blob) => Promise<void>;

function newRunner(
  filter: string,
  onRow: ty.OnRow,
  onStderr: ty.OnStderr,
  instantiate: Instantiate,
): Run {
  const args: Uint8Array[] = ["jaq", "--compact-output", filter].map((v) =>
    new TextEncoder().encode(v),
  );

  return async (input) => {
    const [stdout, flush] = onRowWrite(onRow);
    const wasi = new Wasip1(
      args,
      blobRead(input),
      stdout,
      onStderrWrite(onStderr),
    );
    await wasi.start(instantiate);
    flush();
  };
}

export default class JaqEngine implements ty.EngineImplementation {
  parts: string[] = [];
  instantiate: Instantiate | undefined;

  async evaluate(
    query: string,
    onRow: ty.OnRow,
    onStderr: ty.OnStderr,
  ): Promise<void> {
    if (typeof this.instantiate === "undefined") {
      this.instantiate = await newInstantiate();
    }
    const instantiate = this.instantiate;

    await newRunner(query, onRow, onStderr, instantiate)(new Blob(this.parts));
  }

  async collectEvaluate(
    collection: AsyncIterable<string>,
    query: string,
    store: boolean,
    onRow: ty.OnRow,
    onStderr: ty.OnStderr,
  ): Promise<void> {
    if (typeof this.instantiate === "undefined") {
      this.instantiate = await newInstantiate();
    }
    const instantiate = this.instantiate;
    const run = newRunner(query, onRow, onStderr, instantiate);

    this.parts = [];

    for await (const row of collection) {
      if (store) {
        this.parts.push(row, "\n");
      }

      await run(new Blob([row]));
    }
  }
}

if (import.meta.vitest) {
  /* v8 ignore start */
  const { describe, it, beforeAll, afterAll } = import.meta.vitest;

  beforeAll(async () => {
    const abort = new AbortController();
    const signal = abort.signal;

    // biome-ignore lint/correctness/noNodejsModules: testing
    const { Worker: NodeWorker } = await import("node:worker_threads");
    // biome-ignore lint/correctness/noNodejsModules: testing
    const { Buffer } = await import("node:buffer");

    const script = `//
import { parentPort } from "node:worker_threads"

parentPort.addEventListener("message", async (event) => {
  const [blob, buf] = event.data;
  if (!(blob instanceof Blob)) {
    Atomics.store(mutex, 0, -1);
    Atomics.notify(mutex, 0);
    return;
  }

  if (!(buf instanceof SharedArrayBuffer) || buf.length < Int32Array.BYTES_PER_ELEMENT + blob.size) {
    Atomics.store(mutex, 0, -1);
    Atomics.notify(mutex, 0);
    return;
  }

  const mutex = new Int32Array(buf, 0, 1);
  const b = await blob.bytes();
  new Uint8Array(buf, Int32Array.BYTES_PER_ELEMENT).set(b);
  Atomics.store(mutex, 0, b.length);
  Atomics.notify(mutex, 0);
});`;

    const scriptUrl = new URL(
      `data:text/javascript;base64,${Buffer.from(script).toString("base64")}`,
    );
    const worker = new NodeWorker(scriptUrl);
    signal.addEventListener("abort", () => worker.terminate());

    const { promise, resolve, reject } = Promise.withResolvers();
    worker.addListener("online", resolve);
    worker.addListener("error", reject);
    worker.addListener("error", console.error);
    await promise;

    class BadMannersFileReaderSync implements FileReaderSync {
      readAsArrayBuffer(blob: Blob): ArrayBuffer {
        const buf = new SharedArrayBuffer(
          Int32Array.BYTES_PER_ELEMENT + blob.size,
        );
        const mutex = new Int32Array(buf, 0, 1);
        worker.postMessage([blob, buf]);
        const r = Atomics.wait(mutex, 0, 0, 500);
        if (r === "timed-out") {
          throw new Error(`Fail: ${r}`);
        }
        const n = mutex[0];
        if (n < 0) {
          throw new Error(`Failed: ${n}`);
        }

        const result = new ArrayBuffer(n);
        new Uint8Array(result).set(
          new Uint8Array(buf, Int32Array.BYTES_PER_ELEMENT, n),
        );
        return result;
      }

      readAsText(_blob: Blob, _encoding?: string): string {
        throw new Error("Not implemented.");
      }

      // biome-ignore lint/style/useNamingConvention: Known method name.
      readAsDataURL(_blob: Blob): string {
        throw new Error("Not implemented.");
      }

      readAsBinaryString(_blob: Blob): string {
        throw new Error("Not implemented.");
      }
    }

    Object.assign(globalThis, {
      // biome-ignore lint/style/useNamingConvention: Class name
      FileReaderSync: BadMannersFileReaderSync,
      __testCleanup: () => abort.abort(),
    });
    signal.addEventListener("abort", () => {
      Object.assign(globalThis, {
        // biome-ignore lint/style/useNamingConvention: Class name
        FileReaderSync: undefined,
        __testCleanup: undefined,
      });
    });
  });

  afterAll(() => {
    (globalThis as unknown as { __testCleanup: () => void }).__testCleanup();
  });

  describe("blobRead", () => {
    it("empty", ({ expect }) => {
      const blob = new Blob([]);
      const read = blobRead(blob);
      const n = read(new Uint8Array(128));
      expect(n).toBe(0);
    });

    it("just", ({ expect }) => {
      const blob = new Blob(["Hello, World!"]);
      const read = blobRead(blob);
      const buf = new Uint8Array(13);
      const n = read(buf);
      expect(n).toBe(13);
      expect(new TextDecoder().decode(buf)).toBe("Hello, World!");
    });

    it("large", ({ expect }) => {
      const blob = new Blob(["Hello, World!"]);
      const read = blobRead(blob);
      const buf = new Uint8Array(14);
      const n = read(buf);
      expect(n).toBe(13);
      expect(new TextDecoder().decode(buf)).toBe("Hello, World!\0");
    });

    it("few", ({ expect }) => {
      const blob = new Blob(["Hello, World!"]);
      const read = blobRead(blob);
      const buf = new Uint8Array(12);
      let n = read(buf);
      expect(n).toBe(12);
      expect(new TextDecoder().decode(buf)).toBe("Hello, World");

      n = read(buf);
      expect(n).toBe(1);
      expect(new TextDecoder().decode(buf.slice(0, 1))).toBe("!");
    });
  });

  describe("onRowWrite", () => {
    it("ok", ({ expect }) => {
      const outputs: unknown[] = [];
      const [write, flush] = onRowWrite((row) => outputs.push(row));
      write(new TextEncoder().encode(`{"row":1}\n`));
      write(new TextEncoder().encode(`{"row":2}\n`));
      write(new TextEncoder().encode(`{"row":3}\n`));
      expect(outputs).toEqual([{ row: 1 }, { row: 2 }, { row: 3 }]);

      flush();
      expect(outputs).toEqual([{ row: 1 }, { row: 2 }, { row: 3 }]);
    });

    it("no lf before EOF", ({ expect }) => {
      const outputs: unknown[] = [];
      const [write, flush] = onRowWrite((row) => outputs.push(row));
      write(new TextEncoder().encode(`{"row":1}\n`));
      write(new TextEncoder().encode(`{"row":2}\n`));
      write(new TextEncoder().encode(`{"row":3}`));
      expect(outputs).toEqual([
        { row: 1 },
        { row: 2 },
        //{ row: 3 },
      ]);

      flush();
      expect(outputs).toEqual([{ row: 1 }, { row: 2 }, { row: 3 }]);
    });

    it("scattered", ({ expect }) => {
      const outputs: unknown[] = [];
      const [write, flush] = onRowWrite((row) => outputs.push(row));
      write(new TextEncoder().encode(`{"row`));
      write(new TextEncoder().encode(`":1}`));
      write(new TextEncoder().encode(""));
      write(new TextEncoder().encode(`\n{"row":2}\n{"row":3}\n`));
      expect(outputs).toEqual([{ row: 1 }, { row: 2 }, { row: 3 }]);

      flush();
      expect(outputs).toEqual([{ row: 1 }, { row: 2 }, { row: 3 }]);
    });
  });

  describe("onStderrWrite", () => {
    it("ok", ({ expect }) => {
      let outputs = "";
      const write = onStderrWrite((chunk) => {
        outputs += chunk;
      });
      write(new TextEncoder().encode("Hello, "));
      write(new TextEncoder().encode("World!"));
      write(new TextEncoder().encode("🐣").slice(0, -1)); // Ignoroe: Incomplete Unicode character

      expect(outputs).toBe("Hello, World!");
    });
  });

  describe("JaqEngine", () => {
    it("ok", async () => {
      const engine = new JaqEngine();

      const memory = new WebAssembly.Memory({ initial: 1024 });
      engine.instantiate = (_imports) =>
        Promise.resolve({
          exports: {
            memory,
            _start() {
              // nop
            },
          },
        });

      async function* collect() {
        await Promise.resolve();
        yield "{}";
      }
      const rows: unknown[] = [];
      const errors: string[] = [];
      engine.collectEvaluate(
        collect(),
        ".",
        true,
        (row) => rows.push(row),
        (chunk) => errors.push(chunk),
      );

      engine.evaluate(
        ".",
        (row) => rows.push(row),
        (chunk) => errors.push(chunk),
      );
    });
  });
}
