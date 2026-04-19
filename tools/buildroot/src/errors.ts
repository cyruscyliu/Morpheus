export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, exitCode = 1, details?: unknown) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function assertDefined<T>(value: T | undefined, code: string, message: string): T {
  if (value === undefined) {
    throw new CliError(code, message);
  }
  return value;
}
