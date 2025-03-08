import type * as ty from "../types";
import { Wasip1 } from "./wasi.worker";
import type { Read, Write } from "./wasi.worker";

export const name = "jaq";

let modulePromise: Promise<WebAssembly.Module> | undefined;

function blobRead(input: Blob): Read {
  const reader = new FileReaderSync();
  let data = input;

  return (buf: Uint8Array): number => {
    const n = Math.min(data.size, buf.length);
    const src = reader.readAsArrayBuffer(data.slice(0, n));
    buf.set(new Uint8Array(src));
    data = data.slice(n);
    return n;
  };
}

function onRowWrite(onRow: ty.OnRow): Write {
  const decoder = new TextDecoder();
  let data = "";

  return (buf: Uint8Array): number => {
    data += decoder.decode(buf, { stream: true });
    while (data.length > 0) {
      const n = data.indexOf("\n");
      if (n < 0) {
        break;
      }

      const row = data.slice(0, n);
      data = data.slice(n + 1);
      onRow(JSON.parse(row)); // TODO incorrect case
    }

    return buf.length;
  };
}

async function run(
  input: Blob,
  filter: string,
  onRow: ty.OnRow,
): Promise<void> {
  if (typeof modulePromise === "undefined") {
    const url = new URL("./bin/jaq.wasm", import.meta.url);
    modulePromise = WebAssembly.compileStreaming(fetch(url));
  }
  const module = await modulePromise;

  const args: Uint8Array[] = ["jaq", "--compact-output", filter].map((v) =>
    new TextEncoder().encode(v),
  );

  let msg = "";
  const tput = (() => {
    const dec = new TextDecoder();
    return (buf: Uint8Array): number => {
      msg += dec.decode(buf, { stream: true });
      return buf.length;
    };
  })();
  const wasi = new Wasip1(args, blobRead(input), onRowWrite(onRow), tput);
  try {
    await wasi.start(module);
  } finally {
    if (msg) console.log(msg);
  }
}

export default class JaqEngine implements ty.EngineImplementation {
  parts: string[] = [];

  async evaluate(query: string, onRow: ty.OnRow): Promise<void> {
    await run(new Blob(this.parts), query, onRow);
  }

  async collectEvaluate(
    collection: AsyncIterable<string>,
    query: string,
    store: boolean,
    onRow: ty.OnRow,
  ): Promise<void> {
    this.parts = [];

    for await (const row of collection) {
      if (store) {
        this.parts.push(row, "\n");
      }

      await run(new Blob([row]), query, onRow);
    }
  }
}
