export interface ErrorResponseBody {
  success: false;
  statusCode: number;
  code: string;
  message: string | string[];
  details?: unknown;
  path: string;
  method: string;
  requestId?: string;
  timestamp: string;
  stack?: string; // only ever attached outside production, see filter
}

export function buildErrorResponse(input: {
  statusCode: number;
  code: string;
  message: string | string[];
  details?: unknown;
  path: string;
  method: string;
  requestId?: string;
  stack?: string;
}): ErrorResponseBody {
  return {
    success: false,
    statusCode: input.statusCode,
    code: input.code,
    message: input.message,
    ...(input.details !== undefined ? { details: input.details } : {}),
    path: input.path,
    method: input.method,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.stack ? { stack: input.stack } : {}),
    timestamp: new Date().toISOString(),
  };
}
