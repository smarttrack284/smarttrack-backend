import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from './company.entity';

export enum DigestFrequency {
  OFF = 'off',
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

@Entity('notification_settings')
export class NotificationSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'company_id',
    type: 'uuid',
    unique: true, // one settings row per company — enforced at the DB level, not just app logic
  })
  @Index()
  companyId: string;

  @OneToOne(() => Company, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  // Order lifecycle
  @Column({ name: 'email_order_created', type: 'boolean', default: true })
  emailOrderCreated: boolean;

  @Column({ name: 'email_order_assigned', type: 'boolean', default: true })
  emailOrderAssigned: boolean;

  @Column({ name: 'email_order_picked_up', type: 'boolean', default: true })
  emailOrderPickedUp: boolean;

  @Column({ name: 'email_order_delivered', type: 'boolean', default: true })
  emailOrderDelivered: boolean;

  @Column({ name: 'email_order_failed', type: 'boolean', default: true })
  emailOrderFailed: boolean;

  @Column({ name: 'email_order_cancelled', type: 'boolean', default: true })
  emailOrderCancelled: boolean;

  // Team & drivers
  @Column({ name: 'email_driver_offline', type: 'boolean', default: false })
  emailDriverOffline: boolean;

  @Column({
    name: 'email_team_invite_accepted',
    type: 'boolean',
    default: false,
  })
  emailTeamInviteAccepted: boolean;

  // Security — intentionally not toggle-able off, shown as always-on
  // (no column: this is enforced in the service layer, not a preference)

  // Digest
  @Column({
    name: 'digest_frequency',
    type: 'enum',
    enum: DigestFrequency,
    default: DigestFrequency.OFF,
  })
  digestFrequency: DigestFrequency;

  // SMS
  @Column({ name: 'sms_urgent_only', type: 'boolean', default: false })
  smsUrgentOnly: boolean;

  // Quiet hours
  @Column({ name: 'quiet_hours_enabled', type: 'boolean', default: false })
  quietHoursEnabled: boolean;

  @Column({ name: 'quiet_hours_start', type: 'varchar', nullable: true })
  quietHoursStart: string | null;

  @Column({ name: 'quiet_hours_end', type: 'varchar', nullable: true })
  quietHoursEnd: string | null;
}
