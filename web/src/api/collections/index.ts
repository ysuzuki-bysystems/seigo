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

type FetchOpts = {
  fetch?: typeof globalThis.fetch;
  origin?: typeof globalThis.origin;
};

export async function fetchListCollections(
  opts?: FetchOpts,
): Promise<ListCollectionsResponse> {
  const url = new URL("/api/collections", opts?.origin ?? globalThis.origin);
  const response = await (opts?.fetch ?? globalThis.fetch)(url);
  if (!response.ok) {
    await response.blob(); // drop
    throw new Error(response.statusText);
  }
  const data = await response.json();
  assertsListCollectionsResponse(data);
  return data;
}

if (import.meta.vitest) {
  const { describe, it } = import.meta.vitest;

  describe("fetchListCollections", () => {
    it("ok", async ({ expect }) => {
      const fetch = () => {
        const body: ListCollectionsResponse = {
          collections: [
            {
              name: "ok",
            },
          ],
        };
        return Promise.resolve(new Response(JSON.stringify(body)));
      };
      const origin = "http://example.com/";

      const response = await fetchListCollections({ fetch, origin });

      expect(response).toEqual({
        collections: [
          {
            name: "ok",
          },
        ],
      });
    });

    it("failure", async ({ expect }) => {
      const fetch = () => {
        return Promise.resolve(new Response("Bad request", { status: 400 }));
      };
      const origin = "http://example.com/";

      const response = fetchListCollections({ fetch, origin });

      await expect(response).rejects.toThrow();
    });
  });
}
