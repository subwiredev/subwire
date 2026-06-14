export interface ProtocolErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function protocolErrorBody(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ProtocolErrorBody {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}
