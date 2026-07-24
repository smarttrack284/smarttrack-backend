import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ROLES_KEY } from '#/common/decorators/roles.decorator';
import { InsufficientPermissionsException, UnauthorizedAppException } from '#/common/exceptions';
import { UsersService } from '#/modules/users/users.service';

/**
 * Runs AFTER SupabaseAuthGuard in the guard chain — it reads
 * request.user, which only the auth guard sets. No @Roles() metadata on
 * a route means this guard is a no-op (everyone authenticated passes),
 * matching the existing pattern of most endpoints having no explicit
 * role restriction unless stated.
 *
 * Resolves the caller's role via UsersService.getUserRoleByUserId — same
 * single-company-per-user assumption already used everywhere else in
 * this codebase (OrdersController, TeamService, etc.), not a new one
 * introduced here.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.user) {
      throw new UnauthorizedAppException('Missing authenticated user');
    }

    const userRole = await this.usersService.getUserRoleByUserId(request.user.id);
    if (!requiredRoles.includes(userRole.role)) {
      throw new InsufficientPermissionsException(requiredRoles.join(' or '));
    }

    return true;
  }
}