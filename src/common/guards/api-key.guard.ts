import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { FastifyRequest } from 'fastify';
import { ApiKey } from '#/common/entities/api-key.entity';
import { hashApiKey } from '#/common/utils/api-key-hash.util';
import { UnauthorizedAppException } from '#/common/exceptions';

export const API_KEY_HEADER = 'x-api-key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const presentedKey = request.headers[API_KEY_HEADER] as string | undefined;

    if (!presentedKey) {
      throw new UnauthorizedAppException('Missing API key');
    }

    const keyHash = hashApiKey(presentedKey);
    const record = await this.apiKeyRepo.findOne({
      where: {
        keyHash,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!record) {
      throw new UnauthorizedAppException('Invalid or expired API key');
    }

    // Fire-and-forget update to lastUsedAt
    this.apiKeyRepo.update(record.id, { lastUsedAt: new Date() });

    request.apiKeyCompanyId = record.companyId;
    return true;
  }
}