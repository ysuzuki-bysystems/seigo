"use client";

import { useId } from "react";

type Props = {
  tail: boolean;
  since?: string;
  ready: boolean;
  onToggleTail: (checked: boolean) => void;
  onChangeSince: (value: string) => void;
  onRefresh: () => void;
  onCancel: () => void;
};

export default function Toolbar({
  tail,
  since,
  ready,
  onToggleTail,
  onChangeSince,
  onRefresh,
  onCancel,
}: Props) {
  const tailId = useId();
  const sinceId = useId();

  return (
    <>
      <div className="flex flex-col">
        <label htmlFor={tailId} className="text-xs font-medium text-gray-600">
          Tail
        </label>
        <input
          id={tailId}
          type="checkbox"
          checked={tail}
          onChange={(e) => onToggleTail(e.currentTarget.checked)}
          className="mt-auto"
        />
      </div>

      {!tail && (
        <div className="flex flex-col">
          <label
            htmlFor={sinceId}
            className="text-xs font-medium text-gray-600"
          >
            Since
          </label>
          <input
            id={sinceId}
            type="datetime-local"
            value={since ?? ""}
            onChange={(e) => onChangeSince(e.currentTarget.value)}
            className="p-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
      )}

      <div className="flex gap-2">
        {ready ? (
          <button
            type="button"
            onClick={onRefresh}
            className="px-4 py-1 bg-sky-500 text-white rounded-md text-sm shadow
                      hover:bg-sky-600 transition-colors
                      disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed
                      transform-gpu origin-center
                      transition-transform duration-200 ease-out
                      active:scale-95 active:duration-100 active:ease-in"
          >
            Refresh
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1 bg-red-400 text-white rounded-md text-sm shadow
                      hover:bg-red-500
                      transform-gpu origin-center
                      transition-transform duration-200 ease-out
                      active:scale-90 active:transition-transform"
          >
            Cancel
          </button>
        )}
      </div>
    </>
  );
}
