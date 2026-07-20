import { IsEnum } from 'class-validator';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';

export class UpdateSubscriptionPlanDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;
}
