export type FailureCode =
  | 'OUT_OF_STOCK'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'VALIDATION'
  | 'ALREADY_EXISTS'
  | 'NOT_RELEASED'
  | 'WAITLIST_ACTIVE'
  | 'ALREADY_QUEUED';

export interface Failure {
  readonly code: FailureCode;
  readonly message: string;
}

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Fail {
  readonly ok: false;
  readonly failure: Failure;
}

/** Domain outcomes are values, not exceptions: callers must look at `ok` before using `value`. */
export type Result<T> = Ok<T> | Fail;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function fail(code: FailureCode, message: string): Fail {
  return { ok: false, failure: { code, message } };
}
