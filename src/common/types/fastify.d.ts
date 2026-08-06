import "fastify";
import type { AuthenticatedUser } from "./authenticated-user.type";
import {
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";

declare module "fastify" {
    interface FastifyRequest {
        user?: AuthenticatedUser;
        apiKeyCompanyId?: string;
        subscription?: {
            plan: string;
            status: string;
            companyId: string;
        };
    }
}
