import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '#/common/entities/company.entity';

@Entity('companies_notification_settings')
export class CompanyNotificationSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'company_id',
    type: 'uuid',
    unique: true,
  })
  @Index()
  companyId: string;

  @OneToOne(() => Company, (company) => company.notificationSettings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  /**
   * Global channel switches
   */
  @Column({
    name: 'customer_email_enabled',
    type: 'boolean',
    default: true,
  })
  customerEmailEnabled: boolean;

  @Column({
    name: 'customer_sms_enabled',
    type: 'boolean',
    default: false,
  })
  customerSmsEnabled: boolean;

  /**
   * Customer email notifications
   */
  @Column({
    name: 'customer_email_order_created',
    type: 'boolean',
    default: true,
  })
  customerEmailOrderCreated: boolean;

  @Column({
    name: 'customer_email_order_assigned',
    type: 'boolean',
    default: true,
  })
  customerEmailOrderAssigned: boolean;

  @Column({
    name: 'customer_email_order_picked_up',
    type: 'boolean',
    default: true,
  })
  customerEmailOrderPickedUp: boolean;

  @Column({
    name: 'customer_email_order_in_transit',
    type: 'boolean',
    default: true,
  })
  customerEmailOrderInTransit: boolean;

  @Column({
    name: 'customer_email_order_delivered',
    type: 'boolean',
    default: true,
  })
  customerEmailOrderDelivered: boolean;

  @Column({
    name: 'customer_email_order_failed',
    type: 'boolean',
    default: true,
  })
  customerEmailOrderFailed: boolean;

  @Column({
    name: 'customer_email_order_cancelled',
    type: 'boolean',
    default: true,
  })
  customerEmailOrderCancelled: boolean;

  /**
   * Customer SMS notifications
   */
  @Column({
    name: 'customer_sms_order_created',
    type: 'boolean',
    default: false,
  })
  customerSmsOrderCreated: boolean;

  @Column({
    name: 'customer_sms_order_assigned',
    type: 'boolean',
    default: false,
  })
  customerSmsOrderAssigned: boolean;

  @Column({
    name: 'customer_sms_order_picked_up',
    type: 'boolean',
    default: false,
  })
  customerSmsOrderPickedUp: boolean;

  @Column({
    name: 'customer_sms_order_in_transit',
    type: 'boolean',
    default: false,
  })
  customerSmsOrderInTransit: boolean;

  @Column({
    name: 'customer_sms_order_delivered',
    type: 'boolean',
    default: false,
  })
  customerSmsOrderDelivered: boolean;

  @Column({
    name: 'customer_sms_order_failed',
    type: 'boolean',
    default: false,
  })
  customerSmsOrderFailed: boolean;

  @Column({
    name: 'customer_sms_order_cancelled',
    type: 'boolean',
    default: false,
  })
  customerSmsOrderCancelled: boolean;

  /**
   * Company notifications
   */
  @Column({
    name: 'email_team_member_invited',
    type: 'boolean',
    default: true,
  })
  emailTeamMemberInvited: boolean;

  @Column({
    name: 'email_team_member_joined',
    type: 'boolean',
    default: true,
  })
  emailTeamMemberJoined: boolean;

  /**
   * Operational alerts
   */
  @Column({
    name: 'email_failed_orders',
    type: 'boolean',
    default: true,
  })
  emailFailedOrders: boolean;

  @Column({
    name: 'email_unassigned_orders',
    type: 'boolean',
    default: true,
  })
  emailUnassignedOrders: boolean;
}