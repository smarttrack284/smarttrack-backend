import 'fastify';
import type { AuthenticatedUser } from './authenticated-user.type';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    apiKeyCompanyId?: string
  }
}
