import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserRole } from '#/common/entities/user-role.entity';

@Entity('users_notification_settings')
export class NotificationSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'user_id',
    type: 'uuid',
    unique: true,
  })
  @Index()
  userId: string;

  @OneToOne(() => UserRole, (userRole) => userRole.notificationSettings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  userRole: UserRole;

  // Order lifecycle
  @Column({ name: 'email_order_created', type: 'boolean', default: true })
  emailOrderCreated: boolean;

  @Column({ name: 'email_order_assigned', type: 'boolean', default: true })
  emailOrderAssigned: boolean;

  @Column({ name: 'email_order_picked_up', type: 'boolean', default: true })
  emailOrderPickedUp: boolean;

  @Column({ name: 'email_order_in_transit', type: 'boolean', default: true })
  emailOrderInTransit: boolean;

  @Column({ name: 'email_order_delivered', type: 'boolean', default: true })
  emailOrderDelivered: boolean;

  @Column({ name: 'email_order_failed', type: 'boolean', default: true })
  emailOrderFailed: boolean;

  @Column({ name: 'email_order_cancelled', type: 'boolean', default: true })
  emailOrderCancelled: boolean;
}
