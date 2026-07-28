import {
    Body,
    Controller,
    Get,
    Headers,
    Post,
    Req,
    UseGuards
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { BadRequestAppException } from "#/common/exceptions";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { UsersService } from "#/modules/users/users.service";
import { CompaniesService } from "#/modules/companies/companies.service";
import { BillingService } from "./billing.service";
import { PaystackService } from "#/modules/subscriptions/paystack.service";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { PaystackWebhookHandlerService } from "#/modules/subscriptions/paystack-webhook-handler.service";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { RolesGuard } from "#/common/guards/roles.guard";
import { Roles } from "#/common/decorators/roles.decorator";
import { TeamRoleType } from "#/common/types/team-role.type";

@Controller("billing")
export class BillingController {
    constructor(
        private readonly billingService: BillingService,
        private readonly usersService: UsersService,
        private readonly companiesService: CompaniesService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly paystackService: PaystackService,
        private readonly webhookHandler: PaystackWebhookHandlerService
    ) {}

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER)
    @Get()
    async getOverview(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.billingService.getBillingOverview(userRole.companyId);
    }

    /**
     * Same security posture as the Stripe version this replaces: does NOT
     * change the plan directly. Returns Paystack's authorization_url; the
     * ACTUAL plan change only happens once the subscription.create webhook
     * confirms it — STARTER/PRO still cannot be self-granted by any
     * authenticated user.
     */
    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER)
    @Post("checkout")
    async createCheckout(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: { plan: Exclude<SubscriptionPlan, SubscriptionPlan.FREE> }
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        const company = await this.companiesService.getCompanyById(
            userRole.companyId
        );

        const authorizationUrl =
            await this.paystackService.initializeTransaction({
                companyId: userRole.companyId,
                email: company.email,
                plan: dto.plan
            });

        return { authorizationUrl };
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER)
    @Post("manage")
    async createManageLink(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        const subscription =
            await this.subscriptionsService.getSubscriptionByCompanyId(
                userRole.companyId
            );
        if (!subscription.paymentSubscriptionId) {
            throw new BadRequestAppException(
                "No active subscription exists yet for this workspace"
            );
        }
        const manageUrl = await this.paystackService.generateManageLink(
            subscription.paymentSubscriptionId
        );
        return { manageUrl };
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
        @Roles(TeamRoleType.OWNER)

    @Post("cancel")
    async cancelSubscription(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        const subscription =
            await this.subscriptionsService.getSubscriptionByCompanyId(
                userRole.companyId
            );
        if (!subscription.paymentSubscriptionId) {
            throw new BadRequestAppException(
                "No active subscription exists yet for this workspace"
            );
        }
        await this.paystackService.disableSubscription(
            subscription.paymentSubscriptionId
        );
        return { success: true };
    }

    /**
     * No SupabaseAuthGuard — Paystack calls this, not a browser. Requires
     * the raw body (main.ts's rawBody: true, already set up for the
     * previous Stripe integration and reused as-is here).
     */
    @Post("webhooks/paystack")
    async handlePaystackWebhook(
        @Req() request: FastifyRequest & { rawBody?: Buffer },
        @Headers("x-paystack-signature") signature: string
    ) {
        if (!request.rawBody || !signature) {
            throw new BadRequestAppException("Missing signature or raw body");
        }
        await this.webhookHandler.handle(request.rawBody, signature);
        return { success: true };
    }
}
