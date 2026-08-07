import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  InternalErrorException,
  UnauthorizedAppException,
} from '#/common/exceptions';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '#/common/entities/user-role.entity';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(
    private readonly verifier: SupabaseJwtVerifierService,
    private readonly cache: RedisCacheService,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);

    if (!token) {
      this.logger.warn(
        `Auth failed: missing bearer token [reqId: ${this.getRequestId(request)}]`,
      );
      throw new UnauthorizedAppException('Missing bearer token');
    }

    try {
      const payload = await this.verifier.verify(token);

      // Try to fetch company membership, but don't require it
      const userId: string = payload.id;
      const membership = await this.cache.getOrSet<Pick<
        UserRole,
        'companyId' | 'role' | 'status'
      > | null>(
        `user:company:${userId}`,
        300, // same TTL
        async () =>
          await this.userRoleRepo.findOne({
            where: { userId },
            select: { companyId: true, role: true, status: true },
          }),
      );

      // Attach whatever we found (even if null)
      (request as any).user = {
        ...payload,
        companyId: membership?.companyId ?? null,
        role: membership?.role ?? null,
      };

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedAppException) {
        this.logger.warn(
          `Auth failed: ${err.message} [reqId: ${this.getRequestId(request)}]`,
        );
        throw err;
      }

      this.logger.error(
        `JWT verification system error [reqId: ${this.getRequestId(request)}]: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalErrorException('Authentication service unavailable');
    }
  }

  private extractToken(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (typeof header !== 'string') return null;

    const parts = header.split(' ');
    if (parts.length !== 2) return null;

    const [scheme, token] = parts;
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

    return token;
  }

  private getRequestId(request: FastifyRequest): string {
    return String(request.id ?? 'unknown');
  }
}
