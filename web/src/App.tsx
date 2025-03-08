import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type React from "react";
import "./App.css";

import { fetchListCollections } from "./api";
import type { ListCollectionsResponse } from "./api";
import { Engine } from "./engine";
import type { EngineState } from "./engine";

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
  const fields = Object.entries(state.fields);

  return (
    <table>
      <thead>
        <tr>
          {fields.map(([key]) => (
            <td key={key}>{key}</td>
          ))}
        </tr>
      </thead>
      <tbody>
        {state.records.map(([i, row]) => (
          <tr key={i}>
            {fields.map(([key], i) => (
              <td key={key}>{renderText(row[i])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type LanguageListProps = {
  promise: Promise<string[]>;
  value: string;
  onChange: (value: string) => void;
};

function LanguageList({
  promise,
  value,
  onChange,
}: LanguageListProps): React.ReactNode {
  const initial = useRef(false);

  const languages = use(promise);

  useEffect(() => {
    if (initial.current) {
      return;
    }

    initial.current = true;
    if (value === "" && languages.length > 0) {
      onChange(languages[0]);
    }
  }, [value, onChange, languages]);

  const handleChanges = useCallback<
    React.ChangeEventHandler<HTMLSelectElement>
  >(
    (event) => {
      onChange(event.currentTarget.value);
    },
    [onChange],
  );

  return (
    <select value={value} onChange={handleChanges}>
      {languages.map((lang) => (
        <option key={lang}>{lang}</option>
      ))}
    </select>
  );
}

type CollectionListProps = {
  promise: Promise<ListCollectionsResponse>;
  value: string;
  onChange: (value: string) => void;
};

function CollectionList({
  promise,
  value,
  onChange,
}: CollectionListProps): React.ReactNode {
  const initial = useRef(false);

  const collections = use(promise);

  useEffect(() => {
    if (initial.current) {
      return;
    }

    initial.current = true;
    if (value === "" && collections.collections.length > 0) {
      onChange(collections.collections[0].name);
    }
  }, [value, onChange, collections]);

  const handleChanges = useCallback<
    React.ChangeEventHandler<HTMLSelectElement>
  >(
    (event) => {
      onChange(event.currentTarget.value);
    },
    [onChange],
  );

  return (
    <select value={value} onChange={handleChanges}>
      {collections.collections.map((item) => (
        <option key={item.name}>{item.name}</option>
      ))}
    </select>
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

function App(): React.ReactNode {
  const [language, setLanguage] = useState("");
  const [collection, setCollection] = useState("");
  const [query, setQuery] = useState(".");
  const [since, setSince] = useState(() =>
    datetimeLocalFormat(new Date(Date.now() - 1 * 60 * 60 * 1000)),
  );
  const [tail, setTail] = useState(false);
  const [refresh, setRefresh] = useState(false);

  const [listCollectionsPromise] = useState(fetchListCollections);
  const [engine] = useState(() => new Engine());
  const state = useSyncExternalStore(engine.subscribe, engine.snapshot);

  const handleClicked = useCallback(() => {
    if (tail) {
      engine.startExecution({
        collection,
        language,
        query,
        tail,
      });
    } else {
      engine.startExecution({
        collection,
        language,
        query,
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format
        // > When the time zone offset is absent, date-only forms are interpreted as a UTC time and date-time forms are interpreted as a local time. The interpretation as a UTC time is due to a historical spec error that was not consistent with ISO 8601 but could not be changed due to web compatibility. See Broken Parser – A Web Reality Issue.
        since: typeof since !== "undefined" ? new Date(since) : undefined,
        refresh: refresh || undefined,
      });
    }
  }, [engine, collection, language, query, tail, since, refresh]);

  const handleCancel = useCallback(() => {
    engine.cancel();
  }, [engine]);

  const tailId = useId();
  const refreshId = useId();

  return (
    <>
      <Suspense>
        <LanguageList
          promise={engine.implementations}
          value={language}
          onChange={setLanguage}
        />
      </Suspense>
      <Suspense>
        <CollectionList
          promise={listCollectionsPromise}
          value={collection}
          onChange={setCollection}
        />
      </Suspense>
      <textarea
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <input
        type="datetime-local"
        value={since}
        onChange={(event) => setSince(event.currentTarget.value)}
      />
      <label htmlFor={tailId}>tail</label>
      <input
        id={tailId}
        type="checkbox"
        checked={tail}
        onChange={(event) => setTail(event.currentTarget.checked)}
      />
      <label htmlFor={refreshId}>refresh</label>
      <input
        id={refreshId}
        type="checkbox"
        checked={refresh}
        onChange={(event) => setRefresh(event.currentTarget.checked)}
      />
      {state.ready && (
        <button type="button" onClick={handleClicked}>
          start
        </button>
      )}
      {!state.ready && (
        <button type="button" onClick={handleCancel}>
          cancel
        </button>
      )}
      <StateView state={state} />
      {typeof state.error !== "undefined" && String(state.error)}
    </>
  );
}

export default App;
