import { SetMetadata } from '@nestjs/common';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';

export const REQUIRE_PLAN_KEY = 'requirePlan';

/** @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO) — must be paired with @UseGuards(SupabaseAuthGuard, PlanGuard), same ordering requirement as RolesGuard. */
export const RequirePlan = (...plans: SubscriptionPlan[]) =>
  SetMetadata(REQUIRE_PLAN_KEY, plans);
