/**
 * Canonical HTTP API Error Codes for GroVastra Auto Campaigns Backend
 * Every API error response is guaranteed to have the shape:
 * { success: false, error: string, code: string, fieldPath?: string }
 */

export interface ErrorCodeDefinition {
  code: string;
  httpStatus: number;
  category: 'AUTH' | 'IDEMPOTENCY' | 'VALIDATION' | 'RESOURCE' | 'CONFLICT' | 'SERVER';
  description: string;
}

export const ERROR_CODES = {
  // Authentication & Authorization (401, 403, 429)
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    httpStatus: 401,
    category: 'AUTH',
    description: 'Authentication token is missing, expired, or invalid.'
  },
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    httpStatus: 401,
    category: 'AUTH',
    description: 'Supplied username or password does not match registered credentials.'
  },
  MISSING_CREDENTIALS: {
    code: 'MISSING_CREDENTIALS',
    httpStatus: 400,
    category: 'AUTH',
    description: 'Username and password fields are required for authentication.'
  },
  CROSS_TENANT_FORBIDDEN: {
    code: 'CROSS_TENANT_FORBIDDEN',
    httpStatus: 403,
    category: 'AUTH',
    description: 'Access denied: token tenant does not match requested tenant.'
  },
  FORBIDDEN_ROLE: {
    code: 'FORBIDDEN_ROLE',
    httpStatus: 403,
    category: 'AUTH',
    description: 'User role lacks permission to perform this action.'
  },
  INTERNAL_AUTH_REQUIRED: {
    code: 'INTERNAL_AUTH_REQUIRED',
    httpStatus: 401,
    category: 'AUTH',
    description: 'Internal service token is required in Authorization or x-internal-api-key header.'
  },
  INVALID_CREDENTIAL: {
    code: 'INVALID_CREDENTIAL',
    httpStatus: 401,
    category: 'AUTH',
    description: 'Internal service token signature is invalid or claims are malformed.'
  },
  SERVICE_ROLE_REQUIRED: {
    code: 'SERVICE_ROLE_REQUIRED',
    httpStatus: 403,
    category: 'AUTH',
    description: 'Internal service token must have SYSTEM role.'
  },
  UNAUTHORIZED_EVENT_FAMILY: {
    code: 'UNAUTHORIZED_EVENT_FAMILY',
    httpStatus: 403,
    category: 'AUTH',
    description: 'Internal service token is not permitted to emit events in this event family.'
  },
  MISSING_EVENT_FAMILY: {
    code: 'MISSING_EVENT_FAMILY',
    httpStatus: 403,
    category: 'AUTH',
    description: 'Internal service token is missing mandatory eventFamily claim.'
  },
  EVENT_FAMILY_MISMATCH: {
    code: 'EVENT_FAMILY_MISMATCH',
    httpStatus: 403,
    category: 'AUTH',
    description: 'Internal service token event family does not match required family for route.'
  },
  CROSS_TENANT_PAYLOAD: {
    code: 'CROSS_TENANT_PAYLOAD',
    httpStatus: 403,
    category: 'AUTH',
    description: 'Request body tenantId does not match authenticated credential tenant.'
  },
  CROSS_TENANT_HEADER: {
    code: 'CROSS_TENANT_HEADER',
    httpStatus: 403,
    category: 'AUTH',
    description: 'x-tenant-id header does not match authenticated credential tenant.'
  },
  RATE_LIMIT_EXCEEDED: {
    code: 'RATE_LIMIT_EXCEEDED',
    httpStatus: 429,
    category: 'AUTH',
    description: 'Too many requests; rate limit threshold exceeded.'
  },

  // Idempotency (400, 409, 422)
  IDEMPOTENCY_KEY_REQUIRED: {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
    httpStatus: 400,
    category: 'IDEMPOTENCY',
    description: 'Idempotency-Key header is mandatory for mutating POST/PATCH/DELETE requests.'
  },
  INVALID_IDEMPOTENCY_KEY: {
    code: 'INVALID_IDEMPOTENCY_KEY',
    httpStatus: 400,
    category: 'IDEMPOTENCY',
    description: 'Idempotency-Key must be a non-empty string under 128 characters.'
  },
  IDEMPOTENCY_BODY_MISMATCH: {
    code: 'IDEMPOTENCY_BODY_MISMATCH',
    httpStatus: 422,
    category: 'IDEMPOTENCY',
    description: 'Idempotency key was previously submitted with a different request body or route.'
  },
  IDEMPOTENCY_IN_FLIGHT: {
    code: 'IDEMPOTENCY_IN_FLIGHT',
    httpStatus: 409,
    category: 'IDEMPOTENCY',
    description: 'A request with this idempotency key is currently processing in-flight.'
  },
  IDEMPOTENCY_IN_PROGRESS: {
    code: 'IDEMPOTENCY_IN_PROGRESS',
    httpStatus: 409,
    category: 'IDEMPOTENCY',
    description: 'A request with this idempotency key is currently in-progress.'
  },
  IDEMPOTENCY_CONCURRENT_CONFLICT: {
    code: 'IDEMPOTENCY_CONCURRENT_CONFLICT',
    httpStatus: 409,
    category: 'IDEMPOTENCY',
    description: 'Concurrent mutation conflict encountered while processing idempotency record.'
  },
  IDEMPOTENCY_LOCK_FAILED: {
    code: 'IDEMPOTENCY_LOCK_FAILED',
    httpStatus: 409,
    category: 'IDEMPOTENCY',
    description: 'Failed to acquire concurrency lock on idempotency key.'
  },

  // Resource Not Found (404)
  NOT_FOUND: {
    code: 'NOT_FOUND',
    httpStatus: 404,
    category: 'RESOURCE',
    description: 'The requested resource or API route does not exist.'
  },
  CAMPAIGN_NOT_FOUND: {
    code: 'CAMPAIGN_NOT_FOUND',
    httpStatus: 404,
    category: 'RESOURCE',
    description: 'Campaign with specified ID was not found for this tenant.'
  },
  DRAFT_NOT_FOUND: {
    code: 'DRAFT_NOT_FOUND',
    httpStatus: 404,
    category: 'RESOURCE',
    description: 'Campaign draft version was not found.'
  },
  ENROLLMENT_NOT_FOUND: {
    code: 'ENROLLMENT_NOT_FOUND',
    httpStatus: 404,
    category: 'RESOURCE',
    description: 'Campaign enrollment record was not found.'
  },
  PRESET_NOT_FOUND: {
    code: 'PRESET_NOT_FOUND',
    httpStatus: 404,
    category: 'RESOURCE',
    description: 'Campaign preset identifier does not exist in the catalogue.'
  },
  DELIVERY_INTENT_NOT_FOUND: {
    code: 'DELIVERY_INTENT_NOT_FOUND',
    httpStatus: 404,
    category: 'RESOURCE',
    description: 'No delivery intent found for the specified provider message ID.'
  },

  // Validation & Preconditions (400, 422)
  INVALID_REQUEST: {
    code: 'INVALID_REQUEST',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'Request payload failed schema or structural validation.'
  },
  MISSING_REQUIRED_FIELDS: {
    code: 'MISSING_REQUIRED_FIELDS',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'One or more required fields are missing from the request body.'
  },
  EXPECTED_VERSION_REQUIRED: {
    code: 'EXPECTED_VERSION_REQUIRED',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'Optimistic concurrency control: expectedVersion is required and must be a number.'
  },
  REVIEW_FINGERPRINT_REQUIRED: {
    code: 'REVIEW_FINGERPRINT_REQUIRED',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'Dry-run review fingerprint is mandatory before campaign activation.'
  },
  REVIEW_FINGERPRINT_MISMATCH: {
    code: 'REVIEW_FINGERPRINT_MISMATCH',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'Review fingerprint does not match; draft was modified after the dry run.'
  },
  DRY_RUN_RECORD_NOT_FOUND: {
    code: 'DRY_RUN_RECORD_NOT_FOUND',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'No persisted dry run audit record found matching the review fingerprint.'
  },
  NO_BASE_VERSION_FOUND: {
    code: 'NO_BASE_VERSION_FOUND',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'No base version found to revise or validate.'
  },
  INVALID_PHONE_NUMBER: {
    code: 'INVALID_PHONE_NUMBER',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'Phone number could not be normalized to valid E.164 format.'
  },
  PRESET_NOT_IMPLEMENTED: {
    code: 'PRESET_NOT_IMPLEMENTED',
    httpStatus: 422,
    category: 'VALIDATION',
    description: 'Preset or its underlying event/planner trigger is not yet implemented.'
  },
  SCHEMA_VALIDATION_FAILED: {
    code: 'SCHEMA_VALIDATION_FAILED',
    httpStatus: 422,
    category: 'VALIDATION',
    description: 'Domain event schema does not conform to event registry contract.'
  },
  TEMPLATE_UNUSABLE: {
    code: 'TEMPLATE_UNUSABLE',
    httpStatus: 422,
    category: 'VALIDATION',
    description: 'Step template is paused, rejected, or missing required variable bindings.'
  },
  TEMPLATE_PURPOSE_MISMATCH: {
    code: 'TEMPLATE_PURPOSE_MISMATCH',
    httpStatus: 422,
    category: 'VALIDATION',
    description: 'Template category does not align with campaign purpose.'
  },
  NO_ACTIVE_CONNECTION: {
    code: 'NO_ACTIVE_CONNECTION',
    httpStatus: 422,
    category: 'VALIDATION',
    description: 'No active WhatsApp business connection provisioned for this boutique.'
  },
  UNAUTHORIZED_CONNECTION: {
    code: 'UNAUTHORIZED_CONNECTION',
    httpStatus: 401,
    category: 'VALIDATION',
    description: 'WhatsApp webhook connection cannot be mapped to any active tenant.'
  },
  TENANT_RESOLUTION_FAILED: {
    code: 'TENANT_RESOLUTION_FAILED',
    httpStatus: 400,
    category: 'VALIDATION',
    description: 'Tenant context could not be resolved from connection or request.'
  },
  INVALID_SIGNATURE: {
    code: 'INVALID_SIGNATURE',
    httpStatus: 401,
    category: 'VALIDATION',
    description: 'Meta webhook HMAC-SHA256 signature verification failed.'
  },

  // Concurrency & State Conflicts (409)
  VERSION_CONFLICT: {
    code: 'VERSION_CONFLICT',
    httpStatus: 409,
    category: 'CONFLICT',
    description: 'Version conflict: entity was modified concurrently by another process.'
  },
  STALE_ENTITY_VERSION: {
    code: 'STALE_ENTITY_VERSION',
    httpStatus: 409,
    category: 'CONFLICT',
    description: 'Incoming domain event entityVersion is older than current processed version.'
  },
  CAMPAIGN_ALREADY_ACTIVE: {
    code: 'CAMPAIGN_ALREADY_ACTIVE',
    httpStatus: 409,
    category: 'CONFLICT',
    description: 'Campaign is already active; draft cannot be activated again.'
  },
  CANNOT_MODIFY_PUBLISHED: {
    code: 'CANNOT_MODIFY_PUBLISHED',
    httpStatus: 409,
    category: 'CONFLICT',
    description: 'Published campaign versions are immutable; edits must be made to draft.'
  },

  // Server & Infrastructure (500, 503)
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    httpStatus: 500,
    category: 'SERVER',
    description: 'Unexpected internal error occurred during request processing.'
  },
  WEBHOOK_SECRET_NOT_CONFIGURED: {
    code: 'WEBHOOK_SECRET_NOT_CONFIGURED',
    httpStatus: 500,
    category: 'SERVER',
    description: 'Webhook verification secret is not configured in environment.'
  },
  TEMPLATE_CATALOGUE_UNAVAILABLE: {
    code: 'TEMPLATE_CATALOGUE_UNAVAILABLE',
    httpStatus: 503,
    category: 'SERVER',
    description: 'Template catalogue database service is temporarily unavailable.'
  }
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST: ErrorCodeDefinition[] = Object.values(ERROR_CODES);

export function getErrorCodeDefinition(code: string): ErrorCodeDefinition | undefined {
  return (ERROR_CODES as Record<string, ErrorCodeDefinition>)[code];
}
