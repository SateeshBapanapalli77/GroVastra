export interface StandardErrorResponse {
  success: false;
  error: string;
  code: string;
  fieldPath?: string;
}

export function formatErrorResponse(
  error: string,
  code: string = 'ERROR',
  fieldPath?: string
): StandardErrorResponse {
  const payload: StandardErrorResponse = {
    success: false,
    error,
    code
  };
  if (fieldPath) {
    payload.fieldPath = fieldPath;
  }
  return payload;
}
