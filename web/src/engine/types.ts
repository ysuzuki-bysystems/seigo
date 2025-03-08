export type StartExecutionRequest = {
  type: "start";
  collection: string;
  language: string;
  query: string;
  refresh?: true;
} & (
  | {
      tail: true;
      since?: undefined;
    }
  | {
      tail?: false;
      since?: Date;
    }
);

export type CancelRequest = {
  type: "cancel";
};

export type BeginEvent = {
  type: "begin";
};

export type DoneEvent = {
  type: "done";
};

export type ErrorEvent = {
  type: "error";
  error: unknown;
};

export type RowEvent = {
  type: "row";
  row: object;
};

export type ReadyEvent = {
  type: "ready";
  implementations: string[];
};

export type Request = StartExecutionRequest | CancelRequest;

export type Event = BeginEvent | DoneEvent | ErrorEvent | RowEvent | ReadyEvent;

export type OnRow = (row: object) => void;

export interface EngineImplementation {
  collectEvaluate(
    collection: AsyncIterable<string>,
    query: string,
    store: boolean,
    onRow: OnRow,
  ): Promise<void>;
  evaluate(query: string, onRow: OnRow): void | Promise<void>;
}
