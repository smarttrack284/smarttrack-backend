import { Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { SubscriptionsService } from "./subscriptions.service";
import {
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";

/** Maps Stripe's price ID back to our internal plan enum — env-driven, mirrors StripeService's plan-to-price direction. */
function priceIdToPlan(
    priceId: string,
    starterPriceId?: string,
    proPriceId?: string
): SubscriptionPlan | null {
    if (priceId === starterPriceId) return SubscriptionPlan.STARTER;
    if (priceId === proPriceId) return SubscriptionPlan.PRO;
    return null;
}

function stripeStatusToLocal(
    status: Stripe.Subscription.Status
): SubscriptionStatus {
    switch (status) {
        case "active":
        case "trialing":
            return SubscriptionStatus.ACTIVE;
        case "past_due":
        case "unpaid":
            return SubscriptionStatus.PAST_DUE;
        default:
            return SubscriptionStatus.CANCELED;
    }
}

@Injectable()
export class StripeWebhookHandlerService {
    private readonly logger = new Logger(StripeWebhookHandlerService.name);

    constructor(
        private readonly stripeService: StripeService,
        private readonly subscriptionsService: SubscriptionsService
    ) {}

    async handle(rawBody: Buffer, signature: string): Promise<void> {
        let event: Stripe.Event;
        try {
            event = this.stripeService.constructEvent(rawBody, signature);
        } catch (err) {
            // Invalid signature — this is the actual security boundary of the
            // whole webhook endpoint. Logged and rejected, never processed.
            this.logger.warn(
                `Rejected Stripe webhook: invalid signature (${
                    err instanceof Error ? err.message : err
                })`
            );
            throw err;
        }

        switch (event.type) {
            case "checkout.session.completed":
                await this.handleCheckoutCompleted(
                    event.data.object as Stripe.Checkout.Session
                );
                break;
            case "customer.subscription.updated":
                await this.handleSubscriptionUpdated(
                    event.data.object as Stripe.Subscription
                );
                break;
            case "customer.subscription.deleted":
                await this.subscriptionsService.downgradeToFreOnCancellation(
                    (event.data.object as Stripe.Subscription).id
                );
                break;
            default:
                // Unhandled event types are logged, not errored — Stripe sends
                // many event types this app doesn't need to react to; silently
                // ignoring them is correct, not a gap.
                this.logger.log(`Ignored Stripe event: ${event.type}`);
        }
    }

    private async handleCheckoutCompleted(
        session: Stripe.Checkout.Session
    ): Promise<void> {
        const companyId = session.metadata?.companyId;
        const plan = session.metadata?.plan as SubscriptionPlan | undefined;
        if (!companyId || !plan || !session.subscription || !session.customer)
            return;

        // TODO: fetch the actual current_period_end from the subscription
        // object via stripeService — this checkout.session.completed payload
        // doesn't itself carry it; customer.subscription.updated (handled
        // below) is what actually keeps currentPeriodEnd accurate going
        // forward. This handler primarily exists to catch the FIRST
        // activation moment.
        await this.subscriptionsService.updateFromStripeSubscription({
            companyId,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
            plan,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) // placeholder until the next subscription.updated event corrects it
        });
    }

    private async handleSubscriptionUpdated(
        subscription: Stripe.Subscription
    ): Promise<void> {
        const existing = await this.subscriptionsService.getByStripeCustomerId(
            subscription.customer as string
        );
        if (!existing) return; // subscription for a customer we don't recognize — ignore rather than error on a webhook replay/edge case

        const priceId = subscription.items.data[0]?.price.id;
        const plan = priceIdToPlan(
            priceId,
            process.env.STRIPE_PRICE_ID_STARTER,
            process.env.STRIPE_PRICE_ID_PRO
        );
        if (!plan) {
            this.logger.warn(
                `Could not map Stripe price ${priceId} to a known plan`
            );
            return;
        }

        await this.subscriptionsService.updateFromStripeSubscription({
            companyId: existing.companyId,
            stripeCustomerId: subscription.customer as string,
            stripeSubscriptionId: subscription.id,
            plan,
            status: stripeStatusToLocal(subscription.status),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000)
        });
    }
}
