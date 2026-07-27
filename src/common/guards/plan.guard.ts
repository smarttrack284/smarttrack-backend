import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { REQUIRE_PLAN_KEY } from '#/common/decorators/require-plan.decorator';
import { UnauthorizedAppException } from '#/common/exceptions';
import { UsersService } from '#/modules/users/users.service';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';

/**
 * First real enforcement point for plan-gated features — nothing in this
 * codebase checked subscription tier before serving a feature until now.
 * No @RequirePlan() metadata means the route is open to any plan
 * (matches the "Free plan can use everything except gated features"
 * design), same no-op-by-default convention as RolesGuard.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlans = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PLAN_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPlans || requiredPlans.length === 0) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.user) {
      throw new UnauthorizedAppException('Missing authenticated user');
    }

    const userRole = await this.usersService.getUserRoleByUserId(
      request.user.id,
    );
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(
        userRole.companyId,
      );

    if (!requiredPlans.includes(subscription.plan)) {
      throw new UnauthorizedAppException(
        `This feature requires the ${requiredPlans.join(' or ')} plan. Upgrade to access it.`,
      );
    }

    return true;
  }
}
