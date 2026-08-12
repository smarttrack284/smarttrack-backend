import {
    Column,
    CreateDateColumn, DeleteDateColumn,
    Entity,
    Index,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from "typeorm";
import { Company } from "./company.entity";
import {
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";

export enum PaymentProvider {
    PAYSTACK = "paystack"
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid', unique: true })
  companyId: string;

  @OneToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({
    type: 'enum',
    enum: SubscriptionPlan,
    default: SubscriptionPlan.FREE,
  })
  plan: SubscriptionPlan;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  /** Null for the free plan — there's no billing cycle to renew. */
  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  /**
   * Which payment provider this subscription is billed through. Null for
   * the free plan, since there's nothing to bill. Kept as an explicit enum
   * (rather than inferring it from which ID column is populated) so a
   * future provider migration or multi-provider support doesn't need to
   * guess based on column presence.
   */
  @Column({
    name: 'payment_provider',
    type: 'enum',
    enum: PaymentProvider,
    nullable: true,
  })
  paymentProvider: PaymentProvider | null;

  /**
   * The provider's customer ID (e.g. Stripe's cus_..., Paystack's
   * customer_code) — identifies the BILLING ENTITY (payment methods,
   * invoice history), independent of any specific subscription. Indexed
   * since webhook handlers look this up to find the local company.
   */
  @Column({
    name: 'payment_customer_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Index()
  paymentCustomerId: string | null;

  /**
   * The provider's subscription ID (e.g. Stripe's sub_...) — identifies
   * THIS specific subscription/plan enrollment, distinct from the customer
   * ID above. A customer could in principle have multiple subscriptions
   * over time (upgrade/downgrade often creates a new provider-side
   * subscription); this is the currently-active one. Also indexed, since
   * "subscription.updated"/"subscription.deleted" webhooks arrive keyed by
   * this ID, not the customer ID.
   */
  @Column({
    name: 'payment_subscription_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  paymentSubscriptionId: string | null;

  /**
   * Tracks when the last expiry reminder email was sent.
   * Null if never sent or reset after a successful renewal.
   */
  @Column({
    name: 'last_expiry_reminder_sent_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastExpiryReminderSentAt: Date | null;
  
  @Column({ type: 'boolean', default: false })
cancelAtPeriodEnd: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date;

  /**
   * Returns `true` if a reminder was already sent within the last 24 hours.
   * Used to prevent duplicate emails.
   */
  wasReminderRecentlySent(): boolean {
    if (!this.lastExpiryReminderSentAt) return false;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.lastExpiryReminderSentAt > twentyFourHoursAgo;
  }

  /**
   * Marks that a reminder was just sent.
   */
  markReminderSent(): void {
    this.lastExpiryReminderSentAt = new Date();
  }

  resetReminder(): void {
    this.lastExpiryReminderSentAt = null;
  }
}
