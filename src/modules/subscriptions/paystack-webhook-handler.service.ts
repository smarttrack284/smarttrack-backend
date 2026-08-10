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
        // ---------- Signature verification (security boundary) ----------
        const isValid = this.paystackService.verifyWebhookSignature(
            rawBody,
            signature
        );
        if (!isValid) {
            this.logger.warn({
                msg: "Rejected Paystack webhook: invalid signature"
            });
            throw new UnauthorizedAppException("Invalid webhook signature");
        }

        // ---------- Parse & process ----------
        let event: PaystackWebhookEvent;
        try {
            event = JSON.parse(rawBody.toString("utf-8"));
        } catch {
            this.logger.warn({
                msg: "Rejected Paystack webhook: malformed JSON body"
            });
            return; // 200 OK – prevents retries on an unparseable payload
        }

        // Each event handler is wrapped individually so a failure in one
        // never affects another, and we ALWAYS return 200 OK to Paystack.
        switch (event.event) {
            case "charge.success":
                await this.safeHandle("charge.success", () =>
                    this.handleChargeSuccess(event.data)
                );
                break;

            case "subscription.create":
                await this.safeHandle("subscription.create", () =>
                    this.handleSubscriptionCreate(event.data)
                );
                break;

            case "subscription.renew":
                // A successful recurring charge — update the period end & ensure active
                await this.safeHandle("subscription.renew", () =>
                    this.handleSubscriptionRenew(event.data)
                );
                break;

            case "subscription.disable":
            case "subscription.not_renew":
                await this.safeHandle(event.event, () =>
                    this.subscriptionsService.downgradeToFreeOnCancellation(
                        event.data.subscription_code
                    )
                );
                break;

            case "subscription.expire":
                await this.safeHandle("subscription.expire", () =>
                    this.handleSubscriptionExpire(event.data)
                );
                break;

            case "invoice.payment_failed":
                await this.safeHandle("invoice.payment_failed", () =>
                    this.handleInvoicePaymentFailed(event.data)
                );
                break;

            default:
                this.logger.log(`Ignored Paystack event: ${event.event}`);
        }
    }

    /**
     * Runs the handler callback, logs any error, and NEVER re‑throws.
     * This guarantees a 200 OK response to Paystack regardless of
     * downstream failures, preventing webhook retries.
     */
    private async safeHandle(
        eventName: string,
        handler: () => Promise<void>
    ): Promise<void> {
        try {
            await handler();
        } catch (err) {
            this.logger.error({
                msg: `Paystack webhook handler failed for event "${eventName}"`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            // Intentionally swallowed – prevents retries from Paystack
        }
    }

    private async handleChargeSuccess(
        data: Record<string, any>
    ): Promise<void> {
        const companyId = data.metadata?.companyId;
        if (!companyId) return; // renewal charge, no action needed
        // The plan activation is deferred to the "subscription.create" event
    }

    private async handleSubscriptionCreate(
        data: Record<string, any>
    ): Promise<void> {
        const companyId =
            data.metadata?.companyId ?? data.customer?.metadata?.companyId;
        const plan = this.mapPlanCodeToPlan(data.plan?.plan_code);

        if (!companyId || !plan) {
            this.logger.warn({
                msg: `Could not resolve companyId/plan from subscription.create payload`
            });
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

    /**
     * Fires on every successful recurring charge.  Update the period end
     * so the dashboard always shows the real next payment date, and ensure
     * the subscription is marked ACTIVE (recovery from a previous PAST_DUE).
     */
    private async handleSubscriptionRenew(
        data: Record<string, any>
    ): Promise<void> {
        const subscriptionCode = data.subscription_code;
        if (!subscriptionCode) return;

        // Refresh from Paystack to get authoritative current period end
        const ps =
            await this.paystackService.fetchSubscription(subscriptionCode);
        if (!ps) return;

        const sub =
            await this.subscriptionsService.getByPaystackSubscriptionCode(
                subscriptionCode
            );
        if (!sub) return;

        sub.status = SubscriptionStatus.ACTIVE;
        sub.currentPeriodEnd = new Date(ps.next_payment_date);
        await this.subscriptionsService.save(sub);
    }

    /**
     * Fires when the subscription reaches its end date without renewal.
     * Downgrade to FREE immediately — the user should not retain paid
     * features after the subscription has lapsed.
     */
    private async handleSubscriptionExpire(
        data: Record<string, any>
    ): Promise<void> {
        const subscriptionCode = data.subscription_code;
        if (!subscriptionCode) return;

        const sub =
            await this.subscriptionsService.getByPaystackSubscriptionCode(
                subscriptionCode
            );
        if (!sub) return;

        sub.plan = SubscriptionPlan.FREE;
        sub.status = SubscriptionStatus.CANCELED;
        await this.subscriptionsService.save(sub);

        this.logger.log({
            msg: `Subscription ${subscriptionCode} expired — downgraded company ${sub.companyId} to FREE`
        });
    }

    /**
     * Maps a Paystack plan code to our internal SubscriptionPlan.
     * Returns `null` if the plan code is unrecognised or missing,
     * which causes the subscription.create handler to skip the event.
     */
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
