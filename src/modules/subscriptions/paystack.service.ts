
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Paystack from "@paystack/paystack-sdk";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import {
    BadRequestAppException,
    ExternalServiceException,
    InternalErrorException
} from "#/common/exceptions";

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
 * Amount is always in the smallest currency unit:
 * - GHS → pesewas (1 GHS = 100)
 * - NGN → kobo      (1 NGN = 100)
 * - USD → cents     (1 USD = 100)
 */
export type PaystackTransactionSummary = {
    id: number;
    reference: string;
    amountPesewas: number;
    currency: string;
    status: string;
    paidAt: string | null;
    channel: string | null;
};

@Injectable()
export class PaystackService {
    private readonly paystackCurrency: string;
    private readonly logger = new Logger(PaystackService.name);
    private readonly client: Paystack;
    private readonly webhookSecret: string;
    private readonly clientUrl: string;
    private readonly secretKey: string;

    constructor(private readonly config: ConfigService) {
        this.secretKey = this.config.getOrThrow<string>("PAYSTACK_SECRET_KEY");
        this.clientUrl = this.config.getOrThrow<string>("CLIENT_URL");
        this.paystackCurrency =
            this.config.get<string>("PAYSTACK_CURRENCY") ?? "GHS";

        this.client = new Paystack(this.secretKey);
        // Paystack signs webhooks with the SAME secret key used for API calls
        // — there is no separate webhook-signing secret, unlike Stripe.
        this.webhookSecret = this.secretKey;
    }

    /* ------------------------------------------------------------------ */
    /*  initializeTransaction                                               */
    /* ------------------------------------------------------------------ */

    async initializeTransaction(input: {
        companyId: string;
        email: string;
        plan: Exclude<SubscriptionPlan, SubscriptionPlan.FREE>;
    }): Promise<string> {
        if (!input.companyId?.trim()) {
            throw new BadRequestAppException("Company ID is required.");
        }
        if (!input.email?.trim() || !this.isValidEmail(input.email)) {
            throw new BadRequestAppException(
                "A valid email address is required."
            );
        }

        const planCodeEnvKey = PLAN_TO_CODE_ENV[input.plan];
        const amountEnvKey = PLAN_TO_AMOUNT_ENV[input.plan];
        const planCode = this.config.get<string>(planCodeEnvKey);
        const amount = this.config.get<string>(amountEnvKey);

        if (!planCode || !amount) {
            this.logger.error({
                msg: "Missing Paystack plan configuration",
                plan: input.plan,
                planCodeEnvKey,
                amountEnvKey
            });
            throw new InternalErrorException(
                "Payment plan is not configured. Please contact support."
            );
        }

        try {
            const response = await this.client.transaction.initialize({
                email: input.email.trim(),
                amount,
                plan: planCode,
                currency: this.paystackCurrency,
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
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ExternalServiceException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Paystack initializeTransaction failed",
                companyId: input.companyId,
                email: input.email,
                err: err instanceof Error ? err.message : String(err)
            });

            throw new InternalErrorException(
                "Payment service is temporarily unavailable. Please try again."
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  verifyTransaction                                                   */
    /* ------------------------------------------------------------------ */

    async verifyTransaction(
        reference: string
    ): Promise<Record<string, unknown>> {
        if (!reference?.trim()) {
            throw new BadRequestAppException(
                "Transaction reference is required."
            );
        }

        try {
            const response = await this.client.transaction.verify({
                reference: reference.trim()
            });

            if (!response.status) {
                throw new ExternalServiceException(
                    "Paystack",
                    response.message ?? "Could not verify transaction"
                );
            }

            return response.data as Record<string, unknown>;
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ExternalServiceException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Paystack verifyTransaction failed",
                reference,
                err: err instanceof Error ? err.message : String(err)
            });

            throw new InternalErrorException(
                "Payment service is temporarily unavailable. Please try again."
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  fetchSubscription                                                   */
    /* ------------------------------------------------------------------ */

    async fetchSubscription(
        subscriptionCode: string
    ): Promise<Record<string, unknown>> {
        if (!subscriptionCode?.trim()) {
            throw new BadRequestAppException("Subscription code is required.");
        }

        try {
            const response = await this.client.subscription.fetch({
                code: subscriptionCode.trim()
            });

            if (!response.status) {
                throw new ExternalServiceException(
                    "Paystack",
                    response.message ?? "Could not fetch subscription"
                );
            }

            return response.data as Record<string, unknown>;
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ExternalServiceException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Paystack fetchSubscription failed",
                subscriptionCode,
                err: err instanceof Error ? err.message : String(err)
            });

            throw new InternalErrorException(
                "Payment service is temporarily unavailable. Please try again."
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  disableSubscription                                                 */
    /* ------------------------------------------------------------------ */

    async disableSubscription(subscriptionCode: string): Promise<void> {
        if (!subscriptionCode?.trim()) {
            throw new BadRequestAppException("Subscription code is required.");
        }

        try {
            const subscription = await this.fetchSubscription(subscriptionCode);
            const emailToken = (subscription as any)?.email_token;

            if (!emailToken) {
                throw new ExternalServiceException(
                    "Paystack",
                    "Subscription is missing an email token and cannot be cancelled."
                );
            }

            const response = await this.client.subscription.disable({
                code: subscriptionCode.trim(),
                token: emailToken
            });

            if (!response.status) {
                throw new ExternalServiceException(
                    "Paystack",
                    response.message ?? "Could not cancel subscription"
                );
            }
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ExternalServiceException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Paystack disableSubscription failed",
                subscriptionCode,
                err: err instanceof Error ? err.message : String(err)
            });

            throw new InternalErrorException(
                "Payment service is temporarily unavailable. Please try again."
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  generateManageLink                                                  */
    /* ------------------------------------------------------------------ */
    /**
     * Generates a link that lets the customer update their payment method.
     * Verified endpoint: POST /subscription/{code}/manage/link
     * Some SDK versions expose this as `generateUpdateLink` or `manageLink`.
     * If neither exists, we fall back to a raw HTTP call.
     */
    async generateManageLink(subscriptionCode: string): Promise<string> {
        if (!subscriptionCode?.trim()) {
            throw new BadRequestAppException("Subscription code is required.");
        }

        const code = subscriptionCode.trim();

        try {
            //  Try SDK methods (name varies by SDK version)
            const subClient = this.client.subscription as any;
            const sdkMethod =
                subClient.generateUpdateLink ?? subClient.manageLink;

            if (typeof sdkMethod === "function") {
                const response = await sdkMethod.call(subClient, { code });
                if (response?.status && response.data?.link) {
                    return response.data.link;
                }
                throw new ExternalServiceException(
                    "Paystack",
                    response?.message ?? "Could not generate management link"
                );
            }

            //  Fallback: raw HTTP call ( native fetch)
            const res = await fetch(
                `https://api.paystack.co/subscription/${encodeURIComponent(
                    code
                )}/manage/link`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.secretKey}`,
                        "Content-Type": "application/json"
                    }
                }
            );

            if (!res.ok) {
                const body = await res.text();
                throw new ExternalServiceException(
                    "Paystack",
                    `HTTP ${res.status}: ${body}`
                );
            }

            const data = await res.json();
            if (!data.status || !data.data?.link) {
                throw new ExternalServiceException(
                    "Paystack",
                    data.message ?? "Could not generate management link"
                );
            }

            return data.data.link;
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ExternalServiceException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Paystack generateManageLink failed",
                subscriptionCode: code,
                err: err instanceof Error ? err.message : String(err)
            });

            throw new InternalErrorException(
                "Payment service is temporarily unavailable. Please try again."
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  verifyWebhookSignature                                              */
    /* ------------------------------------------------------------------ */

    verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean {
        if (!signature || typeof signature !== "string") {
            this.logger.warn({
                msg: "Webhook signature verification failed: missing signature"
            });
            return false;
        }

        try {
            const expected = createHmac("sha512", this.webhookSecret)
                .update(rawBody)
                .digest("hex");

            const expectedBuffer = Buffer.from(expected, "hex");
            const providedBuffer = Buffer.from(signature, "hex");

            if (expectedBuffer.length !== providedBuffer.length) {
                this.logger.warn({
                    msg: "Webhook signature verification failed: length mismatch"
                });
                return false;
            }

            return timingSafeEqual(expectedBuffer, providedBuffer);
        } catch (err) {
            this.logger.error({
                msg: "Webhook signature verification error",
                err: err instanceof Error ? err.message : String(err)
            });
            return false; // fail safe
        }
    }

    /* ------------------------------------------------------------------ */
    /*  listTransactionsForCustomer                                         */
    /* ------------------------------------------------------------------ */

    async listTransactionsForCustomer(
        customerCode: string,
        input: { page: number; perPage: number }
    ): Promise<{ transactions: PaystackTransactionSummary[]; total: number }> {
        if (!customerCode?.trim()) {
            throw new BadRequestAppException("Customer code is required.");
        }
        if (input.page < 1 || input.perPage < 1 || input.perPage > 100) {
            throw new BadRequestAppException(
                "Page must be ≥ 1 and perPage must be between 1 and 100."
            );
        }

        try {
            const response = await this.client.transaction.list({
                customer: customerCode.trim(),
                page: input.page,
                perPage: input.perPage
            });

            if (!response.status) {
                throw new ExternalServiceException(
                    "Paystack",
                    response.message ?? "Could not load billing history"
                );
            }

            const transactions: PaystackTransactionSummary[] = (
                (response.data as any[]) ?? []
            ).map((tx: any) => ({
                id: tx.id,
                reference: tx.reference,
                amountPesewas: tx.amount,
                currency: tx.currency ?? this.paystackCurrency,
                status: tx.status,
                paidAt: tx.paid_at ?? null,
                channel: tx.channel ?? null
            }));

            return {
                transactions,
                total: (response.meta as any)?.total ?? transactions.length
            };
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ExternalServiceException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Paystack listTransactionsForCustomer failed",
                customerCode,
                page: input.page,
                perPage: input.perPage,
                err: err instanceof Error ? err.message : String(err)
            });

            throw new InternalErrorException(
                "Payment service is temporarily unavailable. Please try again."
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                             */
    /* ------------------------------------------------------------------ */

    private isValidEmail(email: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
}
