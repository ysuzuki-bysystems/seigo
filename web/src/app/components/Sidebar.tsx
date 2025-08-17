"use client";
import type { ReactNode } from "react";
import { useId } from "react";
import type { ListCollectionsResponse } from "../../api/collections";
import { Play, Trash2 } from "lucide-react";

type Props = {
  open: boolean;

  // options
  collections: ListCollectionsResponse["collections"];
  languages: string[];

  collection: string;
  language: string;
  query: string;
  dirty: boolean;

  // event
  onChangeCollection: (value: string) => void;
  onChangeLanguage: (value: string) => void;
  onChangeQuery: (value: string) => void;
  onApply: () => void;

  // history
  queryHistory: string[];
  onRunHistory: (value: string) => void;
  onRemoveHistory: (index: number) => void;
  onClearHistory: () => void;

  // DON'T PUSH ME Button
  onCrack: () => void;
};

export default function Sidebar({
  open,
  collections,
  languages,
  collection,
  language,
  query,
  dirty,
  onChangeCollection,
  onChangeLanguage,
  onChangeQuery,
  onApply,
  queryHistory,
  onRunHistory,
  onRemoveHistory,
  onClearHistory,
  onCrack,
}: Props): ReactNode {
  if (!open) return null;

  const collectionId = useId();
  const languageId = useId();
  const queryId = useId();

  return (
    <aside className="h-screen bg-sky-50 border-l border-sky-200 p-4 flex flex-col">
      <div className="space-y-4 mb-6 mt-6">
        <div>
          <label
            htmlFor={collectionId}
            className="block text-xs font-medium text-gray-600 mb-1 ml-8"
          >
            Collection
          </label>
          <select
            id={collectionId}
            value={collection}
            onChange={(e) => onChangeCollection(e.currentTarget.value)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm
                      focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white"
          >
            {collections.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={languageId}
            className="block text-xs font-medium text-gray-600 mb-1 ml-8"
          >
            Language
          </label>
          <select
            id={languageId}
            value={language}
            onChange={(e) => onChangeLanguage(e.currentTarget.value)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm
                      focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white"
          >
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label
            htmlFor={queryId}
            className="text-xs font-medium text-gray-600 ml-8"
          >
            Query
          </label>
          <textarea
            id={queryId}
            value={query}
            onChange={(e) => onChangeQuery(e.currentTarget.value)}
            className="w-full h-[40px] rounded border border-gray-300 px-2 py-1 text-sm 
                      focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white"
          />
        </div>
        <button
          type="button"
          disabled={!dirty}
          onClick={onApply}
          className={`px-4 py-1 rounded-md text-sm shadow ${
            dirty
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          Apply
        </button>
      </div>

      <div>
        <div className="flex-1 overflow-y-auto">
          <h2 className="font-bold text-sm">Query History</h2>

          {queryHistory.length > 0 && (
            <button
              onClick={onClearHistory}
              className="text-red-600 text-sm hover:underline"
            >
              Clear All
            </button>
          )}
        </div>
        <ul className="space-y-1 mt-2">
          {queryHistory.map((entry, idx) => (
            <li key={idx} className="flex items-center gap-2">
              <span className="flex-1 truncate">{entry}</span>
              <button
                onClick={() => onRunHistory(entry)}
                className="text-blue-600 hover:underline flex items-center gap-1"
              >
                <Play className="w-4 h-4 text-blue-600 hover:text-blue-800" />
              </button>
              <button
                onClick={() => onRemoveHistory(idx)}
                className="text-red-500 hover:text-blue-600"
              >
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto">
        <button
          onClick={onCrack}
          className="bg-red-600 text-white text-xs rounded-md px-2 py-2 font-bold shadow
                    hover:bg-red-700
                    transform-gpu origin-center
                    transition-colors transition-transform duration-200 ease-out
                    active:scale-95 active:duration-100 active:ease-in"
          >
          DON'T PUSH ME
        </button>
      </div>
    </aside>
  );
}
