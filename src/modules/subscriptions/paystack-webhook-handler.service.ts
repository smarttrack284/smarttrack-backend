import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedAppException } from '#/common/exceptions';
import { PaystackService } from './paystack.service';
import { SubscriptionsService } from './subscriptions.service';
import {
  SubscriptionPlan,
  SubscriptionStatus,
} from '#/common/constants/subscription-plan.constant';

/* ------------------------------------------------------------------ */
/*  Payload interfaces (defensive — partial, only fields we use)       */
/* ------------------------------------------------------------------ */

interface PaystackWebhookEvent<T = unknown> {
  event: string;
  data: T;
}

interface PaystackCustomer {
  customer_code: string;
  email: string;
  metadata?: Record<string, unknown>;
}

interface PaystackPlan {
  plan_code: string;
  name?: string;
}

interface PaystackSubscription {
  id: number;
  subscription_code: string;
  status: string;
  email_token: string;
  customer: PaystackCustomer;
  plan: PaystackPlan;
  next_payment_date: string | null;
  metadata?: Record<string, unknown>;
}

interface PaystackTransaction {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  customer: PaystackCustomer;
  plan?: PaystackPlan;
  subscription?: { subscription_code: string };
  metadata?: Record<string, unknown>;
  paid_at: string | null;
}

interface PaystackInvoice {
  id: number;
  subscription: { subscription_code: string };
  transaction: { reference: string } | null;
  status: string;
  paid: boolean;
}

@Injectable()
export class PaystackWebhookHandlerService {
  private readonly logger = new Logger(PaystackWebhookHandlerService.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Entry point                                                       */
  /* ---------------------------------------------------------------- */

  async handle(rawBody: Buffer, signature?: string): Promise<void> {
    // Signature verification
    const isValid = this.paystackService.verifyWebhookSignature(
      rawBody,
      signature,
    );
    if (!isValid) {
      this.logger.warn({
        msg: 'Rejected Paystack webhook: invalid signature',
      });
      throw new UnauthorizedAppException('Invalid webhook signature');
    }

    //  Parse
    let event: PaystackWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      this.logger.warn({
        msg: 'Rejected Paystack webhook: malformed JSON',
      });
      return; // 200 OK — prevents retries on garbage
    }

    //  _layout — each handler is idempotent and swallows its own errors
    switch (event.event) {
      case 'charge.success':
        await this.safeHandle(
          'charge.success',
          event.data as PaystackTransaction,
          (d) => this.handleChargeSuccess(d),
        );
        break;

      case 'subscription.create':
        await this.safeHandle(
          'subscription.create',
          event.data as PaystackSubscription,
          (d) => this.handleSubscriptionCreate(d),
        );
        break;

      case 'subscription.not_renew':
        await this.safeHandle(
          'subscription.not_renew',
          event.data as PaystackSubscription,
          (d) => this.handleSubscriptionNotRenew(d),
        );
        break;

      case 'subscription.disable':
        await this.safeHandle(
          'subscription.disable',
          event.data as PaystackSubscription,
          (d) => this.handleSubscriptionDisable(d),
        );
        break;

      case 'invoice.update':
        await this.safeHandle(
          'invoice.update',
          event.data as PaystackInvoice,
          (d) => this.handleInvoiceUpdate(d),
        );
        break;

      case 'invoice.payment_failed':
        await this.safeHandle(
          'invoice.payment_failed',
          event.data as PaystackInvoice,
          (d) => this.handleInvoicePaymentFailed(d),
        );
        break;

      case 'invoice.create':
        // Optional: pre-renewal notification logic
        this.logger.log({
          msg: 'Paystack invoice.create received (no-op)',
          subscriptionCode: (event.data as PaystackInvoice).subscription
            ?.subscription_code,
        });
        break;

      default:
        this.logger.log({
          msg: 'Ignored Paystack event',
          event: event.event,
        });
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Safe wrapper — NEVER re-throws                                    */
  /* ---------------------------------------------------------------- */

  private async safeHandle<T>(
    eventName: string,
    data: T,
    handler: (data: T) => Promise<void>,
  ): Promise<void> {
    try {
      await handler(data);
    } catch (err) {
      this.logger.error({
        msg: `Paystack webhook handler failed for event "${eventName}"`,
        err: err instanceof Error ? err.message : String(err),
      });
      // Intentionally swallowed — 200 OK already sent by controller
    }
  }

  /* ---------------------------------------------------------------- */
  /*  charge.success                                                    */
  /* ---------------------------------------------------------------- */
  /**
   * Fires for EVERY successful charge: initial subscription payment,
   * one-time payment, AND recurring renewal charges.
   * For subscriptions, the subscription_code is present on the payload.
   */
  private async handleChargeSuccess(data: PaystackTransaction): Promise<void> {
    const subscriptionCode = data.subscription?.subscription_code;

    // One-time charge (no subscription) — ignore
    if (!subscriptionCode) {
      this.logger.log({
        msg: 'charge.success: one-time charge, no subscription action needed',
        reference: data.reference,
      });
      return;
    }

    // Idempotency: if we already processed this transaction, skip
    const alreadyProcessed =
      await this.subscriptionsService.isTransactionProcessed(data.reference);
    if (alreadyProcessed) {
      this.logger.log({
        msg: 'charge.success: transaction already processed',
        reference: data.reference,
      });
      return;
    }

    // Mark transaction as processed
    await this.subscriptionsService.markTransactionProcessed(data.reference);

    // For renewals, update period end from the transaction's paid_at + plan interval
    // For initial charges, subscription.create will set up the record.
    // This handler ensures renewals are captured even if subscription.create is delayed.
    const sub =
      await this.subscriptionsService.getByPaystackSubscriptionCode(
        subscriptionCode,
      );
    if (!sub) {
      this.logger.warn({
        msg: 'charge.success: subscription not found in local DB',
        subscriptionCode,
        reference: data.reference,
      });
      return;
    }

    // Recovery from past_due
    if (sub.status === SubscriptionStatus.PAST_DUE) {
      sub.status = SubscriptionStatus.ACTIVE;
    }

    // Update period end from next_payment_date if available in metadata,
    // otherwise infer from plan interval. For now, we defer to invoice.update
    // which carries the authoritative next_payment_date.
    await this.subscriptionsService.save(sub);

    this.logger.log({
      msg: 'charge.success: subscription charge confirmed',
      subscriptionCode,
      reference: data.reference,
      companyId: sub.companyId,
    });
  }

  /* ---------------------------------------------------------------- */
  /*  subscription.create                                               */
  /* ---------------------------------------------------------------- */
  /**
   * Fires once when a new subscription is created. The first charge has
   * already succeeded. This is where we bootstrap the local subscription record.
   */
  private async handleSubscriptionCreate(
    data: PaystackSubscription,
  ): Promise<void> {
    const companyId =
      (data.metadata?.companyId as string) ??
      (data.customer.metadata?.companyId as string);

    const plan = this.mapPlanCodeToPlan(data.plan?.plan_code);

    if (!companyId || !plan) {
      this.logger.warn({
        msg: 'subscription.create: could not resolve companyId or plan',
        subscriptionCode: data.subscription_code,
        planCode: data.plan?.plan_code,
      });
      return;
    }

    // Idempotency: skip if already exists
    const existing =
      await this.subscriptionsService.getByPaystackSubscriptionCode(
        data.subscription_code,
      );
    if (existing) {
      this.logger.log({
        msg: 'subscription.create: already processed, skipping',
        subscriptionCode: data.subscription_code,
      });
      return;
    }

    await this.subscriptionsService.updateFromPaystackSubscription({
      companyId,
      paystackCustomerCode: data.customer.customer_code,
      paystackSubscriptionCode: data.subscription_code,
      plan,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: data.next_payment_date
        ? new Date(data.next_payment_date)
        : null,
    });

    this.logger.log({
      msg: 'subscription.create: new subscription recorded',
      companyId,
      subscriptionCode: data.subscription_code,
      plan,
    });
  }

  /* ---------------------------------------------------------------- */
  /*  subscription.not_renew                                            */
  /* ---------------------------------------------------------------- */
  /**
   * Customer cancelled. Current period is still active until next_payment_date.
   * Do NOT downgrade yet — wait for subscription.disable.
   */
  private async handleSubscriptionNotRenew(
    data: PaystackSubscription,
  ): Promise<void> {
    const sub = await this.subscriptionsService.getByPaystackSubscriptionCode(
      data.subscription_code,
    );
    if (!sub) return;

    // Set a flag so the UI can show "Cancels on {date}"
    sub.cancelAtPeriodEnd = true;
    await this.subscriptionsService.save(sub);

    this.logger.log({
      msg: 'subscription.not_renew: marked for cancellation at period end',
      subscriptionCode: data.subscription_code,
      companyId: sub.companyId,
      nextPaymentDate: data.next_payment_date,
    });
  }

  /* ---------------------------------------------------------------- */
  /*  subscription.disable                                              */
  /* ---------------------------------------------------------------- */
  /**
   * Subscription is fully deactivated. Downgrade to FREE immediately.
   * This is the authoritative end-of-subscription event.
   */
  private async handleSubscriptionDisable(
    data: PaystackSubscription,
  ): Promise<void> {
    const sub = await this.subscriptionsService.getByPaystackSubscriptionCode(
      data.subscription_code,
    );
    if (!sub) {
      this.logger.warn({
        msg: 'subscription.disable: subscription not found in local DB',
        subscriptionCode: data.subscription_code,
      });
      return;
    }

    // Idempotency: already downgraded
    if (
      sub.plan === SubscriptionPlan.FREE &&
      sub.status === SubscriptionStatus.CANCELED
    ) {
      return;
    }

    sub.plan = SubscriptionPlan.FREE;
    sub.status = SubscriptionStatus.CANCELED;
    sub.cancelAtPeriodEnd = false;
    await this.subscriptionsService.save(sub);

    this.logger.log({
      msg: 'subscription.disable: downgraded to FREE',
      subscriptionCode: data.subscription_code,
      companyId: sub.companyId,
    });
  }

  /* ---------------------------------------------------------------- */
  /*  invoice.update                                                    */
  /* ---------------------------------------------------------------- */
  /**
   * Fires after a charge attempt on an invoice. If paid=true, the renewal
   * succeeded and we get the authoritative next_payment_date.
   * This is the correct event to update period_end, NOT subscription.renew
   * (which does not exist in Paystack).
   */
  private async handleInvoiceUpdate(data: PaystackInvoice): Promise<void> {
    if (!data.paid) return; // unpaid invoice — handled by invoice.payment_failed

    const sub = await this.subscriptionsService.getByPaystackSubscriptionCode(
      data.subscription.subscription_code,
    );
    if (!sub) return;

    // Fetch fresh subscription from Paystack to get authoritative next_payment_date
    // This is one external call, but it's lightweight and necessary because
    // invoice.update doesn't always include next_payment_date in the payload.
    try {
      const psSub = await this.paystackService.fetchSubscription(
        data.subscription.subscription_code,
      );
      const nextPaymentDate = (psSub as any)?.next_payment_date;

      if (nextPaymentDate) {
        sub.currentPeriodEnd = new Date(nextPaymentDate);
      }

      sub.status = SubscriptionStatus.ACTIVE;
      sub.cancelAtPeriodEnd = false;
      await this.subscriptionsService.save(sub);

      this.logger.log({
        msg: 'invoice.update: renewal confirmed, period extended',
        subscriptionCode: data.subscription.subscription_code,
        companyId: sub.companyId,
        nextPaymentDate,
      });
    } catch (err) {
      this.logger.error({
        msg: 'invoice.update: failed to fetch subscription for period update',
        subscriptionCode: data.subscription.subscription_code,
        err: err instanceof Error ? err.message : String(err),
      });
      // Don't throw — let safeHandle swallow it
    }
  }

  /* ---------------------------------------------------------------- */
  /*  invoice.payment_failed                                            */
  /* ---------------------------------------------------------------- */
  /**
   * Renewal charge failed. Enter grace period (past_due) but do NOT
   * cancel immediately. Paystack retries automatically.
   */
  private async handleInvoicePaymentFailed(
    data: PaystackInvoice,
  ): Promise<void> {
    const subscriptionCode = data.subscription?.subscription_code;
    if (!subscriptionCode) return;

    await this.subscriptionsService.markPastDue(subscriptionCode);
  }

  /* ---------------------------------------------------------------- */
  /*  Plan mapping                                                      */
  /* ---------------------------------------------------------------- */

  private mapPlanCodeToPlan(
    planCode: string | undefined,
  ): SubscriptionPlan | null {
    if (!planCode) return null;
    const starterCode = this.config.get<string>('PAYSTACK_PLAN_CODE_STARTER');
    const proCode = this.config.get<string>('PAYSTACK_PLAN_CODE_PRO');

    if (planCode === starterCode) return SubscriptionPlan.STARTER;
    if (planCode === proCode) return SubscriptionPlan.PRO;
    return null;
  }
}
