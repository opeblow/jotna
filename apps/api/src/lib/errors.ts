/** Errors that are safe to show to API clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = "Sign in to continue") => new AppError(401, "unauthorized", message);
export const forbidden = (code = "forbidden", message = "Not allowed") => new AppError(403, code, message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(422, code, message, details);
export const tooMany = (message: string, details?: Record<string, unknown>) =>
  new AppError(429, "rate_limited", message, details);
export const unavailable = (code: string, message: string) => new AppError(503, code, message);
