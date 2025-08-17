"use client";

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { ReactNode } from "react";
import { fetchListCollections } from "../api/collections/index.ts";
import type { ListCollectionsResponse } from "../api/collections/index.ts";
import { Engine } from "../engine/index.ts";
import { FragmentStore } from "./fragment.ts";
import { Menu, X } from "lucide-react";
import { datetimeLocalFormat } from "./utils/format";
import StateTable from "./components/StateTable";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";

type AppViewProps = {
  fragmentStore: FragmentStore;
  engine: Engine;
  listCollectionsPromise: Promise<ListCollectionsResponse>;
};

function AppView({
  fragmentStore,
  engine,
  listCollectionsPromise,
}: AppViewProps): ReactNode {
  use(fragmentStore.ready);
  const collections = use(listCollectionsPromise);
  const languages = use(engine.implementations);

  const fragment = useSyncExternalStore(
    fragmentStore.subscribe,
    fragmentStore.snapshot,
  );

  const [language, setLanguage] = useState(fragment.language);
  const [collection, setCollection] = useState(fragment.collection);
  const [query, setQuery] = useState(fragment.query || ".");
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

  useEffect(() => {
    setCollection((prev) => {
      if (prev !== "" || collections.collections.length === 0) {
        return prev;
      }
      return collections.collections[0]?.name ?? prev;
    });
  }, [collections]);

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

    setQueryHistory((prev) => [query, ...prev].slice(0, 10));
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

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);

  const [isBroken, setIsBroken] = useState(false);

  const handleCrack = () => {
    setIsBroken(true);
    setTimeout(() => setIsBroken(false), 3000);
  };

  return (
    <div className="flex h-screen min-h-screen bg-slate-50 text-gray-700">
      {isBroken && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div className="w-full h-full bg-[url('/crack.png')] bg-cover animate-shake" />
        </div>
      )}
      <main className="flex-1 p-4 overflow-auto">
        <div className="flex flex-wrap items-end gap-4 mb-6 mt-4">
          <Toolbar
            tail={tail}
            since={since}
            ready={state.ready}
            onToggleTail={setTail}
            onChangeSince={setSince}
            onRefresh={handleRefreshClicked}
            onCancel={handleCancel}
          />
        </div>

        <div className="min-w-full mt-4">
          <StateTable state={state} />
        </div>
        {typeof state.error !== "undefined" && (
          <div className="pt-4">
            <pre className="text-sm text-red-600 bg-red-50 p-2 rounded">
              {state.error}
            </pre>
          </div>
        )}
      </main>
      <div className={`overflow-hidden transition-[width] duration-300 ${sidebarOpen ? "w-80" : "w-0"}`}>
        <Sidebar
          open={sidebarOpen}
          collections={collections.collections}
          languages={languages}
          collection={collection}
          language={language}
          query={query}
          dirty={dirty}
          onChangeCollection={setCollection}
          onChangeLanguage={setLanguage}
          onChangeQuery={setQuery}
          onApply={handleApplyClicked}
          queryHistory={queryHistory}
          onRunHistory={setQuery}
          onRemoveHistory={(idx) =>
            setQueryHistory((prev) => prev.filter((_, i) => i !== idx))
          }
          onClearHistory={() => setQueryHistory([])}
          onCrack={handleCrack}
        />
      </div>

      {/* Sidebar toggle button */}
      <button
        className="absolute top-2 right-2 p-2 bg-gray-200 rounded hover:bg-gray-300 ring-0"
        onClick={() => setSidebarOpen((prev) => !prev)}
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
    </div>
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
