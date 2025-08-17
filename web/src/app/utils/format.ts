// utils/format.ts
import type { ReactNode } from "react";

export function renderText(val: unknown): ReactNode {
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

export function datetimeLocalFormat(date: Date): string | undefined {
  const y = date.getFullYear().toString(10).padStart(4, "0");
  const mo = (date.getMonth() + 1).toString(10).padStart(2, "0");
  const d = date.getDate().toString(10).padStart(2, "0");
  const h = date.getHours().toString(10).padStart(2, "0");
  const m = date.getMinutes().toString(10).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${m}`;
}
