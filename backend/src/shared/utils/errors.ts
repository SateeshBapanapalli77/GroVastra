import { ErrorCode } from '../errorCodes';

export interface StandardErrorResponse {
  success: false;
  error: string;
  code: string;
  fieldPath?: string;
  status?: string;
  message?: string;
  resolutionOwner?: string;
}

export function formatErrorResponse(
  error: string,
  code: ErrorCode | string = 'INTERNAL_ERROR',
  fieldPath?: string,
  extra?: { status?: string; message?: string; resolutionOwner?: string } | string
): StandardErrorResponse {
  const payload: StandardErrorResponse = {
    success: false,
    error,
    code
  };
  if (fieldPath) {
    payload.fieldPath = fieldPath;
  }
  if (typeof extra === 'string') {
    payload.status = extra;
  } else if (extra) {
    if (extra.status) payload.status = extra.status;
    if (extra.message) payload.message = extra.message;
    if (extra.resolutionOwner) payload.resolutionOwner = extra.resolutionOwner;
  }
  return payload;
}
