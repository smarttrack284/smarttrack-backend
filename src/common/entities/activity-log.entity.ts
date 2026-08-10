import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, } from 'typeorm';
import { ActivityCategory, ActivitySeverity, } from '#/common/constants/activity-log.constant';
import { Company } from '#/common/entities/company.entity';

@Entity('activity_logs')
@Index(['companyId', 'createdAt'])
@Index(['companyId', 'category'])
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'enum', enum: ActivityCategory })
  category: ActivityCategory;

  /** Fine-grained type within a category (e.g. 'order.created', 'order.delivered') — used for grouping adjacent similar events, distinct from the coarse category filter. */
  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: string;

  @Column({
    type: 'enum',
    enum: ActivitySeverity,
    default: ActivitySeverity.INFO,
  })
  severity: ActivitySeverity;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 255, nullable: true })
  actorName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
