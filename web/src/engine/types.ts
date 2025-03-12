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

export type StderrEvent = {
  type: "stderr";
  chunk: string;
};

export type RowEvent = {
  type: "row";
  row: unknown;
};

export type ReadyEvent = {
  type: "ready";
  implementations: string[];
};

export type Request = StartExecutionRequest | CancelRequest;

export type Event =
  | BeginEvent
  | DoneEvent
  | StderrEvent
  | RowEvent
  | ReadyEvent;

export type OnRow = (row: object) => void;

export type OnStderr = (chunk: string) => void;

export interface EngineImplementation {
  collectEvaluate(
    collection: AsyncIterable<string>,
    query: string,
    store: boolean,
    onRow: OnRow,
    onStderr: OnStderr,
  ): Promise<void>;
  evaluate(
    query: string,
    onRow: OnRow,
    onStderr: OnStderr,
  ): void | Promise<void>;
}
