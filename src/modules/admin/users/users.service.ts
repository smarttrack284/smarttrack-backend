import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { UserRole } from "#/common/entities/user-role.entity";
import { Company } from "#/common/entities/company.entity";
import { UsersService } from "#/modules/users/users.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import {
    InternalErrorException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { QueryFailedError } from "typeorm";

@Injectable()
export class AdminUsersService {
    private readonly logger = new Logger(AdminUsersService.name);
    private readonly CACHE_TTL_SECONDS = 60;

    constructor(
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        private readonly usersService: UsersService,
        private readonly cache: RedisCacheService,
        private readonly errorHandler: ErrorHandlerService
    ) {}

    async getUserDetail(userId: string) {
        const cacheKey = `admin:users:detail:${userId}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.buildUserDetail(userId)
            );
        } catch (err) {
            this.errorHandler.handle(err, "AdminUsersService.getUserDetail", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to load user details. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    private async buildUserDetail(userId: string) {
        // Fetch Supabase user (includes metadata, ban status, etc.)
        const supabaseUser =
            await this.usersService.getUserFromSupabase(userId);
        if (!supabaseUser) {
            throw new ResourceNotFoundException("User not found");
        }

        // Fetch all company memberships for this user
        const memberships = await this.userRoleRepo.find({
            where: { userId }
        });

        // Fetch companies in one batch
        const companyIds = memberships.map(m => m.companyId);
        const companies = companyIds.length
            ? await this.companyRepo.find({
                  where: { id: In(companyIds) }
              })
            : [];
        const companyMap = new Map(companies.map(c => [c.id, c]));

        const response = {
            user: {
                id: userId,
                email: supabaseUser.email ?? "",
                phone:
                    supabaseUser.phone ??
                    supabaseUser.user_metadata?.phone ??
                    null,
                createdAt: supabaseUser.created_at
                    ? new Date(supabaseUser.created_at)
                    : null,
                isBanned:
                    supabaseUser.banned_until &&
                    new Date(supabaseUser.banned_until) > new Date(),
                metadata: supabaseUser.user_metadata ?? {}
            },
            companies: memberships.map(member => {
                const company = companyMap.get(member.companyId);
                return {
                    companyId: member.companyId,
                    companyName: company?.name ?? "Unknown",
                    role: member.role,
                    status: member.status,
                    joinedAt: member.joinedAt
                };
            })
        };

        this.logger.log({
            msg: "Loaded user detail",
            userId,
            companies: memberships.length
        });

        return response;
    }
}
