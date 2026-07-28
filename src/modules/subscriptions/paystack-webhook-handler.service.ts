import { Injectable, Logger } from "@nestjs/common";
import { UnauthorizedAppException } from "#/common/exceptions";
import { PaystackService } from "./paystack.service";
import { SubscriptionsService } from "./subscriptions.service";
import {
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";

type PaystackWebhookEvent = {
    event: string;
    data: Record<string, any>;
};

@Injectable()
export class PaystackWebhookHandlerService {
    private readonly logger = new Logger(PaystackWebhookHandlerService.name);

    constructor(
        private readonly paystackService: PaystackService,
        private readonly subscriptionsService: SubscriptionsService
    ) {}

    async handle(rawBody: Buffer, signature: string): Promise<void> {
        const isValid = this.paystackService.verifyWebhookSignature(
            rawBody,
            signature
        );
        if (!isValid) {
            // Invalid signature — the real security boundary of this endpoint.
            // Rejected outright, never parsed or processed further.
            this.logger.warn("Rejected Paystack webhook: invalid signature");
            throw new UnauthorizedAppException("Invalid webhook signature");
        }

        let event: PaystackWebhookEvent;
        try {
            event = JSON.parse(rawBody.toString("utf-8"));
        } catch {
            this.logger.warn("Rejected Paystack webhook: malformed JSON body");
            return;
        }

        switch (event.event) {
            case "charge.success":
                await this.handleChargeSuccess(event.data);
                break;
            case "subscription.create":
                await this.handleSubscriptionCreate(event.data);
                break;
            case "subscription.disable":
            case "subscription.not_renew":
                await this.subscriptionsService.downgradeToFreeOnCancellation(
                    event.data.subscription_code
                );
                break;
            case "invoice.payment_failed":
                await this.handleInvoicePaymentFailed(event.data);
                break;
            default:
                this.logger.log(`Ignored Paystack event: ${event.event}`);
        }
    }

    /**
     * charge.success fires for the initial checkout AND every subsequent
     * renewal charge. metadata (companyId, plan) is only present on the
     * FIRST charge (the one initializeTransaction created) — renewal
     * charges triggered by Paystack itself won't carry it, since they're
     * not initiated through our own initializeTransaction call. This
     * handler is a no-op for renewals; subscription.create (below) is what
     * actually activates the plan for a NEW subscription.
     */
    private async handleChargeSuccess(
        data: Record<string, any>
    ): Promise<void> {
        const companyId = data.metadata?.companyId;
        if (!companyId) return; // a renewal charge, not the initial checkout — nothing to do here
        // Verified separately via subscription.create, which carries the
        // authoritative subscription_code — this handler intentionally does
        // NOT activate the plan itself, to avoid a race between two events
        // both trying to be the "source of truth" for activation.
    }

    private async handleSubscriptionCreate(
        data: Record<string, any>
    ): Promise<void> {
        const companyId =
            data.metadata?.companyId ?? data.customer?.metadata?.companyId;
        const plan = this.mapPlanCodeToPlan(data.plan?.plan_code);

        if (!companyId || !plan) {
            this.logger.warn(
                `Could not resolve companyId/plan from subscription.create payload`
            );
            return;
        }

        await this.subscriptionsService.updateFromPaystackSubscription({
            companyId,
            paystackCustomerCode: data.customer.customer_code,
            paystackSubscriptionCode: data.subscription_code,
            plan,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(data.next_payment_date)
        });
    }

    private async handleInvoicePaymentFailed(
        data: Record<string, any>
    ): Promise<void> {
        const subscriptionCode = data.subscription?.subscription_code;
        if (!subscriptionCode) return;
        await this.subscriptionsService.markPastDue(subscriptionCode);
    }

    private mapPlanCodeToPlan(
        planCode: string | undefined
    ): SubscriptionPlan | null {
        if (!planCode) return null;
        if (planCode === process.env.PAYSTACK_PLAN_CODE_STARTER)
            return SubscriptionPlan.STARTER;
        if (planCode === process.env.PAYSTACK_PLAN_CODE_PRO)
            return SubscriptionPlan.PRO;
        return null;
    }
}
