import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { ExternalServiceException } from "#/common/exceptions";

const PLAN_TO_PRICE_ID_ENV: Record<
    Exclude<SubscriptionPlan, SubscriptionPlan.FREE>,
    string
> = {
    [SubscriptionPlan.STARTER]: "STRIPE_PRICE_ID_STARTER",
    [SubscriptionPlan.PRO]: "STRIPE_PRICE_ID_PRO"
};

/**
 * The ONLY place the Stripe SDK is imported/used — every other service
 * talks to this, never to `stripe` directly, same discipline as
 * EmailProvider/StorageService. Makes a future provider swap (or adding
 * Paystack alongside Stripe, matching the PaymentProvider enum already
 * on Subscription) a contained change.
 */
@Injectable()
export class StripeService {
    private readonly client: Stripe;
    private readonly webhookSecret: string;
    private readonly clientUrl: string;

    constructor(private readonly config: ConfigService) {
        const secretKey = this.config.get<string>("STRIPE_SECRET_KEY");
        const webhookSecret = this.config.get<string>("STRIPE_WEBHOOK_SECRET");
        const clientUrl = this.config.get<string>("CLIENT_URL");
        if (!secretKey || !webhookSecret || !clientUrl) {
            throw new Error(
                "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and CLIENT_URL must be configured"
            );
        }
        this.client = new Stripe(secretKey);
        this.webhookSecret = webhookSecret;
        this.clientUrl = clientUrl;
    }

    async findOrCreateCustomer(
        companyId: string,
        companyEmail: string,
        existingCustomerId: string | null
    ): Promise<string> {
        if (existingCustomerId) return existingCustomerId;

        const customer = await this.client.customers.create({
            email: companyEmail,
            metadata: { companyId } // links a Stripe customer back to our company — read by webhook handlers
        });
        return customer.id;
    }

    async createCheckoutSession(input: {
        companyId: string;
        stripeCustomerId: string;
        plan: Exclude<SubscriptionPlan, SubscriptionPlan.FREE>;
    }): Promise<string> {
        const priceEnvKey = PLAN_TO_PRICE_ID_ENV[input.plan];
        const priceId = this.config.get<string>(priceEnvKey);
        if (!priceId) throw new Error(`${priceEnvKey} is not configured`);

        const session = await this.client.checkout.sessions.create({
            mode: "subscription",
            customer: input.stripeCustomerId,
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${this.clientUrl}/dashboard/settings?billing_success=1`,
            cancel_url: `${this.clientUrl}/dashboard/settings?billing_cancelled=1`,
            metadata: { companyId: input.companyId, plan: input.plan }
        });

        if (!session.url)
            throw new ExternalServiceException(
                "Stripe",
                "Checkout session had no redirect URL"
            );
        return session.url;
    }

    async createBillingPortalSession(
        stripeCustomerId: string
    ): Promise<string> {
        const session = await this.client.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `${this.clientUrl}/dashboard/settings`
        });
        return session.url;
    }

    /** Verifies the webhook signature against the RAW body — never the parsed/re-serialized one, which would produce a different byte sequence and always fail verification. */
    constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
        return this.client.webhooks.constructEvent(
            rawBody,
            signature,
            this.webhookSecret
        );
    }
}
