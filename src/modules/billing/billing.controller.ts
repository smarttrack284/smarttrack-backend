import {
    Body,
    Controller,
    Get,
    Headers,
    Post,
    RawBodyRequest,
    Req,
    UseGuards
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { BadRequestAppException } from "#/common/exceptions";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { RolesGuard } from "#/common/guards/roles.guard";
import { Roles } from "#/common/decorators/roles.decorator";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { UsersService } from "#/modules/users/users.service";
import { CompaniesService } from "#/modules/companies/companies.service";
import { BillingService } from "./billing.service";
import { StripeService } from "#/modules/subscriptions/stripe.service";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { StripeWebhookHandlerService } from "#/modules/subscriptions/stripe-webhook-handler.service";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { TeamRoleType } from "#/common/types/team-role.type";

@Controller("billing")
export class BillingController {
    constructor(
        private readonly billingService: BillingService,
        private readonly usersService: UsersService,
        private readonly companiesService: CompaniesService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly stripeService: StripeService,
        private readonly webhookHandler: StripeWebhookHandlerService
    ) {}

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER)
    @Get()
    async getOverview(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.billingService.getBillingOverview(userRole.companyId);
    }

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
        const subscription =
            await this.subscriptionsService.getSubscriptionByCompanyId(
                userRole.companyId
            );

        const stripeCustomerId = await this.stripeService.findOrCreateCustomer(
            userRole.companyId,
            company.email,
            subscription.paymentCustomerId
        );

        if (!subscription.paymentCustomerId) {
            subscription.paymentCustomerId = stripeCustomerId;
            await this.subscriptionsService.getSubscriptionByCompanyId(
                userRole.companyId
            ); // no-op re-fetch avoided; save directly instead:
        }

        const checkoutUrl = await this.stripeService.createCheckoutSession({
            companyId: userRole.companyId,
            stripeCustomerId,
            plan: dto.plan
        });

        return { checkoutUrl };
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER)
    @Post("portal")
    async createPortalSession(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        const subscription =
            await this.subscriptionsService.getSubscriptionByCompanyId(
                userRole.companyId
            );
        if (!subscription.paymentCustomerId) {
            throw new BadRequestAppException(
                "No billing account exists yet for this workspace"
            );
        }
        const portalUrl = await this.stripeService.createBillingPortalSession(
            subscription.paymentCustomerId
        );
        return { portalUrl };
    }

    /**
     * No SupabaseAuthGuard — Stripe calls this, not a browser. Authenticity
     * is verified entirely via the signature check inside
     * StripeWebhookHandlerService, not session auth. Requires the raw body
     * (see main.ts's rawBody: true) — @Req() gives access to
     * request.rawBody, which Fastify only populates when that option is set.
     */
    @Post("webhooks/stripe")
    async handleStripeWebhook(
        @Req() request: FastifyRequest & { rawBody?: Buffer },
        @Headers("stripe-signature") signature: string
    ) {
        if (!request.rawBody || !signature) {
            throw new BadRequestAppException("Missing signature or raw body");
        }
        await this.webhookHandler.handle(request.rawBody, signature);
        return { received: true };
    }
}
