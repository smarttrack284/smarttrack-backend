export enum SubscriptionPlan {
    FREE = "free",
    STARTER = "starter",
    PRO = "pro"
}

export interface PlanFeatures {
    maxOrders: number | null;
    maxTeams: number | null;

    basicOverviewDashboard: boolean;
    advancedOverviewDashboard: boolean;
    analyticsDashboard: boolean;

    customerEmailNotifications: boolean;
    customerSMSNotifications: boolean;

    apiIntegrationAccess: boolean;
    importOrders: boolean;
    webhooks: boolean;
}

export const SUBSCRIPTION_PLAN_FEATURES: Record<
    SubscriptionPlan,
    PlanFeatures
> = {
    [SubscriptionPlan.FREE]: {
        maxOrders: 50,
        maxTeams: 2,

        basicOverviewDashboard: true,
        advancedOverviewDashboard: false,
        analyticsDashboard: false,

        customerEmailNotifications: true,
        customerSMSNotifications: false,

        apiIntegrationAccess: false,
        importOrders: false,
        webhooks: false
    },

    [SubscriptionPlan.STARTER]: {
        maxOrders: 500,
        maxTeams: 10,

        basicOverviewDashboard: true,
        advancedOverviewDashboard: true,
        analyticsDashboard: true,

        customerEmailNotifications: true,
        customerSMSNotifications: true,

        apiIntegrationAccess: true,
        importOrders: true,
        webhooks: false
    },

    [SubscriptionPlan.PRO]: {
        maxOrders: null,
        maxTeams: null,

        basicOverviewDashboard: true,
        advancedOverviewDashboard: true,
        analyticsDashboard: true,

        customerEmailNotifications: true,
        customerSMSNotifications: true,

        apiIntegrationAccess: true,
        importOrders: true,
        webhooks: true
    }
};

/**
 * Returns all features available for a subscription plan.
 */
export function getPlanFeatures(
    plan: SubscriptionPlan
): PlanFeatures {
    return SUBSCRIPTION_PLAN_FEATURES[plan];
}

/**
 * Convenience helper for checking a single feature.
 */
export function hasPlanFeature<K extends keyof PlanFeatures>(
    plan: SubscriptionPlan,
    feature: K
): PlanFeatures[K] {
    return SUBSCRIPTION_PLAN_FEATURES[plan][feature];
}