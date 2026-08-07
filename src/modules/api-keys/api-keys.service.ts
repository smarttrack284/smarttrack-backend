import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository } from 'typeorm'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ApiKey } from '#/common/entities/api-key.entity'
import {
  API_KEY_EVENTS,
  ApiKeyCreatedEvent,
  ApiKeyRevokedEvent,
} from '#/common/events/api-key.events'
import {
  buildApiKeyPreview,
  generateApiKey,
} from '#/common/utils/api-key.util'
import { hashApiKey } from '#/common/utils/api-key-hash.util'
import {
  ForbiddenAppException,
  InternalErrorException,
  ResourceNotFoundException,
} from '#/common/exceptions'
import { CreateApiKeyDto } from './dto/create-api-key.dto'
import { ErrorHandlerService, rule } from '#/common/errors/error-handler.service'
import { QueryFailedError } from 'typeorm'

const MAX_KEYS_PER_COMPANY = 10

export type CreatedApiKeyResult = {
  id: string
  name: string
  keyPreview: string
  plainKey: string
  createdAt: Date
  expiresAt: Date | null
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    private readonly events: EventEmitter2,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  async createApiKey(
    companyId: string,
    dto: CreateApiKeyDto,
  ): Promise<CreatedApiKeyResult> {
    try {
      const existingCount = await this.apiKeyRepo.count({
        where: { companyId, revokedAt: IsNull() },
      })
      if (existingCount >= MAX_KEYS_PER_COMPANY) {
        throw new ForbiddenAppException(
          `You can have at most ${MAX_KEYS_PER_COMPANY} active API keys`,
        )
      }

      const plainKey = generateApiKey('live')
      const expiresAt = dto.expiresInDays
        ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
        : null

      const apiKey = this.apiKeyRepo.create({
        companyId,
        name: dto.name,
        keyHash: hashApiKey(plainKey),
        keyPreview: buildApiKeyPreview(plainKey),
        expiresAt,
      })
      const saved = await this.apiKeyRepo.save(apiKey)

      this.events.emit(
        API_KEY_EVENTS.CREATED,
        new ApiKeyCreatedEvent(companyId, saved.name),
      )

      return {
        id: saved.id,
        name: saved.name,
        keyPreview: saved.keyPreview,
        plainKey,
        createdAt: saved.createdAt,
        expiresAt: saved.expiresAt,
      }
    } catch (err) {
      this.errorHandler.handle(err, 'ApiKeysService.createApiKey', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to create API key at this time. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ])
    }
  }

  async listForCompany(companyId: string): Promise<Omit<ApiKey, 'keyHash'>[]> {
    try {
      const keys = await this.apiKeyRepo.find({
        where: { companyId, revokedAt: IsNull() },
        order: { createdAt: 'DESC' },
      })
      return keys.map(({ keyHash, ...rest }) => rest)
    } catch (err) {
      this.errorHandler.handle(err, 'ApiKeysService.listForCompany', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to list API keys at this time. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ])
    }
  }

  async revokeApiKey(companyId: string, apiKeyId: string): Promise<void> {
    try {
      const apiKey = await this.apiKeyRepo.findOne({
        where: { id: apiKeyId },
      })
      if (!apiKey) throw new ResourceNotFoundException('API key cannot be found')
      if (apiKey.companyId !== companyId) {
        throw new ForbiddenAppException(
          'This API key does not belong to your company',
        )
      }
      if (apiKey.revokedAt) return

      apiKey.revokedAt = new Date()
      await this.apiKeyRepo.save(apiKey)

      this.events.emit(
        API_KEY_EVENTS.REVOKED,
        new ApiKeyRevokedEvent(companyId, apiKey.name),
      )
    } catch (err) {
      this.errorHandler.handle(err, 'ApiKeysService.revokeApiKey', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to revoke API key at this time. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ])
    }
  }
}