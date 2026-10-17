export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function errorBody(error: HttpError): { error: { code: string; message: string } & Record<string, unknown> } {
  return { error: { code: error.code, message: error.message, ...error.extra } };
}
