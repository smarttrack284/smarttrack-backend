import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Paystack } from "@paystack/paystack-sdk";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { ExternalServiceException } from "#/common/exceptions";

const PLAN_TO_CODE_ENV: Record<
    Exclude<SubscriptionPlan, SubscriptionPlan.FREE>,
    string
> = {
    [SubscriptionPlan.STARTER]: "PAYSTACK_PLAN_CODE_STARTER",
    [SubscriptionPlan.PRO]: "PAYSTACK_PLAN_CODE_PRO"
};

const PLAN_TO_AMOUNT_ENV: Record<
    Exclude<SubscriptionPlan, SubscriptionPlan.FREE>,
    string
> = {
    [SubscriptionPlan.STARTER]: "PAYSTACK_AMOUNT_STARTER_PESEWAS",
    [SubscriptionPlan.PRO]: "PAYSTACK_AMOUNT_PRO_PESEWAS"
};

/**
 * The ONLY place the Paystack SDK is imported/used — mirrors the same
 * discipline StripeService had (and EmailProvider/StorageService before
 * it). Plans are created ONCE in the Paystack dashboard (or via a
 * one-off setup script, not this service), and referenced here by their
 * plan_code — this service never creates plans at runtime.
 *
 * Amounts are in PESEWAS (Ghana's minor currency unit, same concept as
 * Stripe's cents/kobo) — GHS 1 = 100 pesewas. Currency is GHS
 * explicitly on every call, since Paystack accounts can support multiple
 * currencies depending on country configuration.
 */
@Injectable()
export class PaystackService {
    private readonly client: Paystack;
    private readonly webhookSecret: string;
    private readonly clientUrl: string;

    constructor(private readonly config: ConfigService) {
        const secretKey = this.config.get<string>("PAYSTACK_SECRET_KEY");
        const clientUrl = this.config.get<string>("CLIENT_URL");
        if (!secretKey || !clientUrl) {
            throw new Error(
                "PAYSTACK_SECRET_KEY and CLIENT_URL must be configured"
            );
        }
        this.client = new Paystack(secretKey);
        this.webhookSecret = secretKey; // Paystack signs webhooks with the SAME secret key used for API calls — there is no separate webhook-signing secret, unlike Stripe.
        this.clientUrl = clientUrl;
    }

    /**
     * Finds or implicitly creates a Paystack customer. Unlike Stripe,
     * Paystack doesn't require an explicit "create customer" step before
     * initializing a transaction — passing an email is enough, and
     * Paystack either reuses an existing customer with that email or
     * creates one. We still track customer_code locally once we learn it
     * (from the webhook), so this method is really just a pass-through of
     * the email for the initial checkout call.
     */
    async initializeTransaction(input: {
        companyId: string;
        email: string;
        plan: Exclude<SubscriptionPlan, SubscriptionPlan.FREE>;
    }): Promise<string> {
        const planCodeEnvKey = PLAN_TO_CODE_ENV[input.plan];
        const amountEnvKey = PLAN_TO_AMOUNT_ENV[input.plan];
        const planCode = this.config.get<string>(planCodeEnvKey);
        const amount = this.config.get<string>(amountEnvKey);

        if (!planCode || !amount) {
            throw new Error(
                `${planCodeEnvKey} and ${amountEnvKey} must be configured`
            );
        }

        const response = await this.client.transaction.initialize({
            email: input.email,
            amount, // must match the plan's configured amount — Paystack validates this server-side
            plan: planCode,
            currency: "GHS",
            callback_url: `${this.clientUrl}/dashboard/settings?billing_return=1`,
            metadata: { companyId: input.companyId, plan: input.plan }
        });

        if (!response.status || !response.data?.authorization_url) {
            throw new ExternalServiceException(
                "Paystack",
                response.message ?? "Could not initialize transaction"
            );
        }

        return response.data.authorization_url;
    }

    /** Called from the checkout.session-equivalent webhook path (charge.success) to confirm a transaction actually completed, rather than trusting the redirect alone. */
    async verifyTransaction(reference: string) {
        const response = await this.client.transaction.verify({ reference });
        if (!response.status) {
            throw new ExternalServiceException(
                "Paystack",
                response.message ?? "Could not verify transaction"
            );
        }
        return response.data;
    }

    async fetchSubscription(subscriptionCode: string) {
        const response = await this.client.subscription.fetch({
            code: subscriptionCode
        });
        if (!response.status) {
            throw new ExternalServiceException(
                "Paystack",
                response.message ?? "Could not fetch subscription"
            );
        }
        return response.data;
    }

    /**
     * Cancels a subscription. Paystack's disable endpoint requires BOTH the
     * subscription code and its email_token (a value only present on the
     * subscription object itself, not something we choose) — fetched fresh
     * here rather than stored, since it's specific to Paystack's API shape
     * and not something this app needs to persist.
     */
    async disableSubscription(subscriptionCode: string): Promise<void> {
        const subscription = await this.fetchSubscription(subscriptionCode);
        const response = await this.client.subscription.disable({
            code: subscriptionCode,
            token: subscription.email_token
        });
        if (!response.status) {
            throw new ExternalServiceException(
                "Paystack",
                response.message ?? "Could not cancel subscription"
            );
        }
    }

    /**
     * UNVERIFIED against current Paystack API docs in this session — Paystack
     * exposes a subscription "management link" concept (lets a customer
     * update their card without a full billing portal like Stripe's), but I
     * could not confirm the exact current endpoint/method name with high
     * confidence here. Double-check this against Paystack's live API
     * reference before relying on it — if the SDK method name differs, this
     * is the one call in the whole module most likely to need a small fix.
     */
    async generateManageLink(subscriptionCode: string): Promise<string> {
        const response = await this.client.subscription.generateUpdateLink({
            code: subscriptionCode
        });
        if (!response.status || !response.data?.link) {
            throw new ExternalServiceException(
                "Paystack",
                response.message ?? "Could not generate management link"
            );
        }
        return response.data.link;
    }

    /**
     * Verifies the webhook signature — HMAC-SHA512 of the RAW request body,
     * using the account's secret key, compared against x-paystack-signature.
     * Constant-time comparison (timingSafeEqual), not `===`, for the same
     * timing-attack reasoning applied to API key verification earlier.
     */
    verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
        const expected = createHmac("sha512", this.webhookSecret)
            .update(rawBody)
            .digest("hex");
        const expectedBuffer = Buffer.from(expected, "hex");
        const providedBuffer = Buffer.from(signature, "hex");
        if (expectedBuffer.length !== providedBuffer.length) return false;
        return timingSafeEqual(expectedBuffer, providedBuffer);
    }
}
