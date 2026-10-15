import { ulid } from 'ulid';

export type IdPrefix =
  | 'cmp'  // Campaign
  | 'cv'   // Campaign Version
  | 'enr'  // Enrollment
  | 'exe'  // Execution
  | 'di'   // Delivery Intent
  | 'evt'  // Domain Event
  | 'cus'  // Customer
  | 'ord'  // Order
  | 'prd'  // Product
  | 'chk'  // Checkpoint
  | 'cg'   // Contact Gate
  | 'tg'   // Tenant Gate
  | 'tomb' // Tombstone
  | 'set'  // Settings
  | 'dr'   // Dry Run
  | 'aud'  // Audit Log
  | 'idemp'; // Idempotency Record

export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}
