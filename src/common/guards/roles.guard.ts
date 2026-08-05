// import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';
// import type { FastifyRequest } from 'fastify';
// import { ROLES_KEY } from '#/common/decorators/roles.decorator';
// import { InsufficientPermissionsException, UnauthorizedAppException } from '#/common/exceptions';
// import { UsersService } from '#/modules/users/users.service';

// /**
// * Runs AFTER SupabaseAuthGuard in the guard chain — it reads
// * request.user, which only the auth guard sets. No @Roles() metadata on
// * a route means this guard is a no-op (everyone authenticated passes),
// * matching the existing pattern of most endpoints having no explicit
// * role restriction unless stated.
// *
// * Resolves the caller's role via UsersService.getUserRoleByUserId — same
// * single-company-per-user assumption already used everywhere else in
// * this codebase (OrdersController, TeamService, etc.), not a new one
// * introduced here.
// */
// @Injectable()
// export class RolesGuard implements CanActivate {
//   constructor(
//     private readonly reflector: Reflector,
//     private readonly usersService: UsersService,
//   ) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
//       context.getHandler(),
//       context.getClass(),
//     ]);

//     if (!requiredRoles || requiredRoles.length === 0) return true;

//     const request = context.switchToHttp().getRequest<FastifyRequest>();
//     if (!request.user) {
//       throw new UnauthorizedAppException('Missing authenticated user');
//     }

//     const userRole = await this.usersService.getUserRoleByUserId(request.user.id);
//     if (!requiredRoles.includes(userRole.role)) {
//       throw new InsufficientPermissionsException(requiredRoles.join(' or '));
//     }

//     return true;
//   }
// }

import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ROLES_KEY } from "#/common/decorators/roles.decorator";
import {
    InsufficientPermissionsException,
    InternalErrorException,
    UnauthorizedAppException
} from "#/common/exceptions";
import { UsersService } from "#/modules/users/users.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { PlanGuard } from "#/common/guards/plan.guard";

/**
 * Minimal shape we cache to avoid TypeORM metadata bloat.
 */
interface UserRoleCache {
    role: string;
    companyId: string;
}

@Injectable()
export class RolesGuard implements CanActivate {
    private readonly logger = new Logger(RolesGuard.name);

    // Same TTL as PlanGuard so both guards stay in sync.
    // A role change is typically rare, but 60s keeps it fresh enough.
    private readonly USER_ROLE_TTL = 60;

    constructor(
        private readonly reflector: Reflector,
        private readonly usersService: UsersService,
        private readonly cache: RedisCacheService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()]
        );

        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest<FastifyRequest>();

        if (!request.user?.id) {
            throw new UnauthorizedAppException("Missing authenticated user");
        }

        const userId = request.user.id;
        const reqId = String(request.id ?? "unknown");

        try {
            // Share the cache key with PlanGuard so the first guard to run
            // warms the cache for the second. This eliminates the duplicate
            // DB roundtrip when both guards are applied to the same route.
            const userRole = await this.cache.getOrSet<UserRoleCache | null>(
                PlanGuard.userRoleKey(userId),
                this.USER_ROLE_TTL,
                async () => {
                    const role = await this.usersService.getUserRoleByUserId(
                        userId
                    );
                    return role ? this.toCacheShape(role) : null;
                }
            );

            if (!userRole) {
                this.logger.warn(
                    `RolesGuard: No role record for user ${userId} [reqId: ${reqId}]`
                );
                throw new UnauthorizedAppException("User role not found");
            }

            const normalizedRequired = requiredRoles.map(r =>
                r.toLowerCase().trim()
            );
            const actualRole = userRole.role?.toLowerCase()?.trim();

            if (!actualRole) {
                this.logger.error(
                    `RolesGuard: User ${userId} has an empty role assignment [reqId: ${reqId}]`
                );
                throw new InternalErrorException("User role configuration error");
            }

            if (!normalizedRequired.includes(actualRole)) {
                this.logger.warn(
                    `RolesGuard: Access denied for user ${userId}. ` +
                        `Required: [${normalizedRequired.join(
                            ", "
                        )}], Actual: ${actualRole} [reqId: ${reqId}]`
                );
                throw new InsufficientPermissionsException(
                    "You do not have permission to access this resource"
                );
            }

            // Enrich the request so downstream code (controllers, other guards,
            // interceptors) can read the role without another DB hit.
            request.userRole = userRole;

            return true;
        } catch (err) {
            // Pass through known auth exceptions without wrapping so the
            // response status code and message stay correct.
            if (
                err instanceof UnauthorizedAppException ||
                err instanceof InsufficientPermissionsException
            ) {
                throw err;
            }

            this.logger.error(
                `RolesGuard: System error for user ${userId} [reqId: ${reqId}]: ${
                    err instanceof Error ? err.message : String(err)
                }`,
                err instanceof Error ? err.stack : undefined
            );
            throw new InternalErrorException("Unable to verify user permissions");
        }
    }

    /**
     * Strip TypeORM metadata / circular refs before caching.
     */
    private toCacheShape(raw: any): UserRoleCache {
        return {
            role: raw.role,
            companyId: raw.companyId
        };
    }
}