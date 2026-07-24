import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { FastifyRequest } from 'fastify';
import { ApiKey } from '#/common/entities/api-key.entity';
import { hashApiKey } from '#/common/utils/api-key-hash.util';
import { UnauthorizedAppException } from '#/common/exceptions';

const API_KEY_HEADER = 'x-api-key';

/**
 * Authenticates a request via an API key instead of a Supabase session —
 * for server-to-server integrations, not browser clients. Verification
 * is a direct hash lookup (WHERE key_hash = ?), not a scan-and-compare
 * loop — same reasoning as the earlier decision when the hashing utils
 * were built: HMAC is deterministic, so an indexed equality lookup is
 * both simpler and correctly indexed.
 *
 * On success, sets request.apiKeyCompanyId — downstream services should
 * scope their queries to THIS, not to a user's own company membership,
 * since there's no user session here at all.
 *
 * lastUsedAt is updated fire-and-forget (not awaited) — a failed/slow
 * write to that column should never block or fail the actual request.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const presentedKey = request.headers[API_KEY_HEADER] as string | undefined;

    if (!presentedKey) {
      throw new UnauthorizedAppException('Missing API key');
    }

    const keyHash = hashApiKey(presentedKey);
    const record = await this.apiKeyRepo.findOne({
      where: { keyHash, revokedAt: IsNull() },
    });

    if (!record) {
      throw new UnauthorizedAppException('Invalid or revoked API key');
    }

    request.apiKeyCompanyId = record.companyId;

    this.apiKeyRepo.update(record.id, { lastUsedAt: new Date() }).catch(() => {
      // Best-effort — a failed lastUsedAt write must never fail the request.
    });

    return true;
  }
}