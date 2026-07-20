export enum SubscriptionPlan {
  FREE = 'free',
  STARTER = 'starter',
  PRO = 'pro',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  PAST_DUE = 'past_due',
}

export type PlanLimits = {
  /** null = unlimited */
  orderLimit: number | null;
  /** null = unlimited */
  teamMemberLimit: number | null;
};

/**
 * MVP-level plan definitions — mirrors the same three-tier shape as the
 * frontend's earlier billing mock (plans array in use-billing-overview.ts), just
 * renamed to match the actual product tiers (free/starter/pro) rather than
 * the placeholder (starter/growth/scale) used there. Numbers here are a
 * reasonable MVP starting point, not confirmed pricing — revisit once
 * real usage data exists.
 */
export const SUBSCRIPTION_PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  [SubscriptionPlan.FREE]: { orderLimit: 50, teamMemberLimit: 2 },
  [SubscriptionPlan.STARTER]: { orderLimit: 500, teamMemberLimit: 10 },
  [SubscriptionPlan.PRO]: { orderLimit: null, teamMemberLimit: null },
};
