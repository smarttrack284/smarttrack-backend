import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, MoreThan, Or, Repository } from "typeorm";
import { FastifyRequest } from "fastify";
import { ApiKey } from "#/common/entities/api-key.entity";
import { hashApiKey } from "#/common/utils/api-key-hash.util";
import {
    InternalErrorException,
    UnauthorizedAppException
} from "#/common/exceptions";

export const API_KEY_HEADER = "x-api-key";

@Injectable()
export class ApiKeyGuard implements CanActivate {
    private readonly logger = new Logger(ApiKeyGuard.name);

    constructor(
        @InjectRepository(ApiKey)
        private readonly apiKeyRepo: Repository<ApiKey>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        const presentedKey = request.headers[API_KEY_HEADER] as
            | string
            | undefined;

        if (!presentedKey) {
            throw new UnauthorizedAppException("Missing API key");
        }

        try {
            const keyHash = hashApiKey(presentedKey);

            const record = await this.apiKeyRepo.findOne({
                where: {
                    keyHash,
                    revokedAt: IsNull(),
                    expiresAt: Or(IsNull(), MoreThan(new Date()))
                }
            });

            if (!record) {
                throw new UnauthorizedAppException(
                    "Invalid or expired API key"
                );
            }

            // Non-blocking audit update with error isolation
            this.apiKeyRepo
                .update(record.id, { lastUsedAt: new Date() })
                .catch(err =>
                    this.logger.error("Failed to update lastUsedAt", err)
                );

            request.apiKeyCompanyId = record.companyId;
            return true;
        } catch (err) {
            this.logger.error(
                `API Key auth error [reqId: ${request.id}]`,
                err instanceof Error ? err.stack : String(err)
            );

            if (err instanceof UnauthorizedAppException) {
                throw err;
            }

            throw new InternalErrorException(
                "Authentication service unavailable"
            );
        }
    }
}
