import type { ReactNode } from "react";
import { stateFields, stateRows } from "../../engine/index.ts";
import type { EngineState } from "../../engine/index.ts";
import { renderText } from "../utils/format";

type Props = { state: EngineState };

export default function StateTable({ state }: Props): ReactNode {
  const fields = stateFields(state);

  return (
    <table className="text-sm text-gray-700 bg-white rounded-md overflow-hidden shadow-sm">
      <thead className="bg-sky-100 text-sky-800 uppercase tracking-wider text-xs font-mono">
        <tr>
          {fields.map((field) => (
            <th className="px-4 py-2 text-left border-none" key={field}>
              {field}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-transparent">
        {Array.from(stateRows(state, fields), ([index, row]) => (
          <tr
            className="even:bg-sky-50 hover:bg-sky-100 transition"
            key={index}
          >
            {row.map(([key, val]) => (
              <td className="px-4 py-2 border-none font-mono" key={key}>
                {renderText(val)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
