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

export interface EngineImplementation {
  collectEvaluate(
    collection: AsyncIterable<string>,
    query: string,
    store: boolean,
  ): AsyncIterable<object>;
  evaluate(query: string): AsyncIterable<object>;
}
