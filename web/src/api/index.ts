import * as v from "valibot";

export type CollectionItem = {
  name: string;
};

export type ListCollectionsResponse = {
  collections: CollectionItem[];
};

const ListCollectionsResponse: v.GenericSchema<ListCollectionsResponse> =
  v.object({
    collections: v.array(
      v.object({
        name: v.string(),
      }),
    ),
  });

function assertsListCollectionsResponse(
  val: unknown,
): asserts val is ListCollectionsResponse {
  v.parse(ListCollectionsResponse, val);
}

export async function fetchListCollections(): Promise<ListCollectionsResponse> {
  const url = new URL("/api/collections", globalThis.origin);
  const response = await fetch(url);
  if (!response.ok) {
    await response.blob(); // drop
    throw new Error(response.statusText);
  }
  const data = await response.json();
  assertsListCollectionsResponse(data);
  return data;
}

export type CollectOpts = {
  name: string;
  since?: Date;
  tail?: boolean;
};

export function collect(
  opts: CollectOpts,
  signal: AbortSignal,
): AsyncIterable<string> {
  const params = new URLSearchParams({});
  if (opts.tail) {
    params.append("tail", "true");
  }
  if (typeof opts.since !== "undefined") {
    params.append("since", opts.since.toISOString());
  }

  const base = new URL("/api/collections/", globalThis.origin);
  const url = new URL(opts.name, base);
  url.search = params.toString();

  const { readable, writable } = new TransformStream<string, string>();

  const writer = writable.getWriter();

  const source = new EventSource(url);
  signal.addEventListener("abort", () => {
    source.close();
    writer.abort(signal.reason);
  });
  source.addEventListener("message", (event) =>
    writer.write(event.data as string),
  );
  source.addEventListener("eof", () => {
    source.close();
    writer.close().catch(console.warn); // TODO
  });
  source.addEventListener("error", () => writer.abort()); // TODO

  // https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream#async_iteration_of_a_stream_using_for_await...of
  // TODO Safari ... x
  return readable as unknown as AsyncIterable<string>;
}
