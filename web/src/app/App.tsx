"use client";

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChangeEventHandler } from "react";
import type React from "react";

import { fetchListCollections } from "../api/collections/index.ts";
import type { ListCollectionsResponse } from "../api/collections/index.ts";
import { Engine, stateFields, stateRows } from "../engine/index.ts";
import type { EngineState } from "../engine/index.ts";
import { FragmentStore } from "./fragment.ts";

function renderText(val: unknown): React.ReactNode {
  if (typeof val === "undefined") {
    return "(undefined)";
  }
  if (val === "null") {
    return "null";
  }
  if (typeof val === "number" || typeof val === "bigint") {
    return val.toString(10);
  }
  if (typeof val === "string") {
    return val;
  }
  if (val === true || val === false) {
    return String(val);
  }

  return JSON.stringify(val);
}

function StateView({ state }: { state: EngineState }): React.ReactNode {
  const fields = stateFields(state);
  return (
    <table>
      <thead>
        <tr>
          {fields.map((field) => (
            <th key={field}>{field}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from(stateRows(state, fields), ([index, row]) => (
          <tr key={index}>
            {row.map(([key, val]) => (
              <td key={key}>{renderText(val)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function datetimeLocalFormat(date: Date): string | undefined {
  // really ???
  const y = date.getFullYear().toString(10).padStart(4, "0");
  const mo = (date.getMonth() + 1).toString(10).padStart(2, "0");
  const d = date.getDate().toString(10).padStart(2, "0");
  const h = date.getHours().toString(10).padStart(2, "0");
  const m = date.getMinutes().toString(10).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${m}`;
}

type AppViewProps = {
  fragmentStore: FragmentStore;
  engine: Engine;
  listCollectionsPromise: Promise<ListCollectionsResponse>;
};

function AppView({
  fragmentStore,
  engine,
  listCollectionsPromise,
}: AppViewProps): React.ReactNode {
  use(fragmentStore.ready);
  const collections = use(listCollectionsPromise);
  const languages = use(engine.implementations);

  const fragment = useSyncExternalStore(
    fragmentStore.subscribe,
    fragmentStore.snapshot,
  );

  const [language, setLanguage] = useState(fragment.language);
  const [collection, setCollection] = useState(fragment.collection);
  const [query, setQuery] = useState(fragment.query);
  const [since, setSince] = useState(() =>
    datetimeLocalFormat(new Date(Date.now() - 1 * 60 * 60 * 1000)),
  );
  const [tail, setTail] = useState(false);

  const state = useSyncExternalStore(engine.subscribe, engine.snapshot);

  useEffect(() => {
    if (fragment.collection === "" || fragment.language === "") {
      return;
    }

    engine.cancel();
    if (tail) {
      engine.startExecution({
        collection: fragment.collection,
        language: fragment.language,
        query: fragment.query,
        tail: tail,
      });
    } else {
      engine.startExecution({
        collection: fragment.collection,
        language: fragment.language,
        query: fragment.query,
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format
        // > When the time zone offset is absent, date-only forms are interpreted as a UTC time and date-time forms are interpreted as a local time. The interpretation as a UTC time is due to a historical spec error that was not consistent with ISO 8601 but could not be changed due to web compatibility. See Broken Parser – A Web Reality Issue.
        since: typeof since !== "undefined" ? new Date(since) : undefined,
      });
    }
  }, [fragment, engine, tail, since]);

  const handleCollectionChanges = useCallback<
    ChangeEventHandler<HTMLSelectElement>
  >((event) => {
    setCollection(event.currentTarget.value);
  }, []);
  useEffect(() => {
    setCollection((prev) => {
      if (prev !== "" || collections.collections.length === 0) {
        return prev;
      }
      return collections.collections[0]?.name ?? prev;
    });
  }, [collections]);

  const handleLanguageChanges = useCallback<
    ChangeEventHandler<HTMLSelectElement>
  >((event) => {
    setLanguage(event.currentTarget.value);
  }, []);
  useEffect(() => {
    setLanguage((prev) => {
      if (prev !== "" || languages.length === 0) {
        return prev;
      }
      return languages[0] ?? prev;
    });
  }, [languages]);

  const handleApplyClicked = useCallback(() => {
    fragmentStore.set({
      language,
      collection,
      query,
    });
  }, [fragmentStore, language, collection, query]);

  const handleRefreshClicked = useCallback(() => {
    if (tail) {
      engine.startExecution({
        collection: fragment.collection,
        language: fragment.language,
        query: fragment.query,
        tail: tail,
        refresh: true,
      });
    } else {
      engine.startExecution({
        collection: fragment.collection,
        language: fragment.language,
        query: fragment.query,
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format
        // > When the time zone offset is absent, date-only forms are interpreted as a UTC time and date-time forms are interpreted as a local time. The interpretation as a UTC time is due to a historical spec error that was not consistent with ISO 8601 but could not be changed due to web compatibility. See Broken Parser – A Web Reality Issue.
        since: typeof since !== "undefined" ? new Date(since) : undefined,
        refresh: true,
      });
    }
  }, [fragment, engine, tail, since]);

  const handleCancel = useCallback(() => {
    engine.cancel();
  }, [engine]);

  const dirty =
    fragment.collection !== collection ||
    fragment.language !== language ||
    fragment.query !== query;

  const collectionId = useId();
  const languageId = useId();
  const queryId = useId();
  const sinceId = useId();
  const tailId = useId();

  return (
    <>
      <label htmlFor={collectionId}>collection</label>
      <select
        id={collectionId}
        value={collection}
        onChange={handleCollectionChanges}
      >
        {collections.collections.map((item) => (
          <option key={item.name}>{item.name}</option>
        ))}
      </select>

      <label htmlFor={languageId}>language</label>
      <select id={languageId} value={language} onChange={handleLanguageChanges}>
        {languages.map((lang) => (
          <option key={lang}>{lang}</option>
        ))}
      </select>

      <label htmlFor={queryId}>query</label>
      <textarea
        id={queryId}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />

      {state.ready && (
        <button type="button" disabled={!dirty} onClick={handleApplyClicked}>
          apply
        </button>
      )}

      <input
        id={tailId}
        type="checkbox"
        checked={tail}
        onChange={(event) => setTail(event.currentTarget.checked)}
      />
      <label htmlFor={tailId}>tail</label>
      {!tail && (
        <>
          <label htmlFor={sinceId}>since</label>
          <input
            id={sinceId}
            type="datetime-local"
            value={since}
            onChange={(event) => setSince(event.currentTarget.value)}
          />
        </>
      )}
      {state.ready &&
        fragment.collection !== "" &&
        fragment.language !== "" && (
          <button type="button" onClick={handleRefreshClicked}>
            refresh
          </button>
        )}
      {!state.ready && (
        <button type="button" onClick={handleCancel}>
          cancel
        </button>
      )}
      <StateView state={state} />
      {typeof state.error !== "undefined" && <pre>{state.error}</pre>}
    </>
  );
}

function App(): React.ReactNode {
  const [fragmentStore] = useState(() => new FragmentStore());
  const [engine] = useState(() => new Engine());
  const [listCollectionsPromise] = useState(fetchListCollections);

  return (
    <Suspense>
      <AppView
        fragmentStore={fragmentStore}
        engine={engine}
        listCollectionsPromise={listCollectionsPromise}
      />
    </Suspense>
  );
}

export default App;
