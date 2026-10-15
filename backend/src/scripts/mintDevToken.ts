import { env } from '../config/env';
import { signJwt, UserRole } from '../shared/middleware/auth.middleware';

if (env.NODE_ENV === 'production') {
  console.error('Refusing to mint tokens in production.');
  process.exit(1);
}
const tenantId = process.argv[2] || env.DEFAULT_TENANT_ID;
const role = (process.argv[3] || 'BOUTIQUE_OWNER') as UserRole;
console.log(signJwt({ userId: `dev_${role.toLowerCase()}`, tenantId, role }));
