import { IsEnum } from 'class-validator';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';

export class UpdateCompanyPlanDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;
}
