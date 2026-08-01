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

  // @Column({
  //   name: 'customer_sms_enabled',
  //   type: 'boolean',
  //   default: false,
  // })
  // customerSmsEnabled: boolean;

  /**
   * Master switch for ALL Team Emails
   * (Replaces individual joined/suspended/activated switches)
   */
  @Column({
    name: 'team_email_enabled',
    type: 'boolean',
    default: true,
  })
  teamEmailEnabled: boolean;

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

  // The individual team properties have been removed.
}
